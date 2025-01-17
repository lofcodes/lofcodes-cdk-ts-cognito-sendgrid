import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { RemovalPolicy, Tags, Duration } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as customResources from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { CognitoSendGridStackProps, DeploymentStage } from '../types';

export class CognitoSendGridStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props: CognitoSendGridStackProps) {
    super(scope, id, props);

    const cognitoTriggersCmk = new kms.Key(this, `${this.stackName}-kms-symmetric-key`, {
      keySpec: kms.KeySpec.SYMMETRIC_DEFAULT,
      alias: `/${props.applicationName}/cognitoTriggersCmk/${props.stage}`,
      enableKeyRotation: false,
      removalPolicy: props.stage === DeploymentStage.PROD
        ? RemovalPolicy.RETAIN
        : RemovalPolicy.DESTROY,
    });

    cognitoTriggersCmk.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['kms:Encrypt'],
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('cognito-idp.amazonaws.com')],
        resources: ['*'], // TODO: Enforce POLP and constrain by resource
      }),
    );

    const failureTopic = new sns.Topic(this, `${this.stackName}-failure-topic`);
    failureTopic.addSubscription(new sns_subscriptions.EmailSubscription(props.errorNotificationEmail));

    const sendGridAPIKeyParameterName = `/${props.applicationName}/sendGrid/apiKey/${props.stage}`;

    new customResources.AwsCustomResource(this, `${this.stackName}-sendgrid-api-key`, {
      onCreate: {
        service: 'SSM',
        action: 'putParameter',
        parameters: {
          Name: sendGridAPIKeyParameterName,
          Value: 'secure-placeholder', // Default placeholder value
          Type: 'SecureString',
          Overwrite: true,
        },
        physicalResourceId: customResources.PhysicalResourceId.of(sendGridAPIKeyParameterName),
      },
      onUpdate: {
        service: 'SSM',
        action: 'putParameter',
        parameters: {
          Name: sendGridAPIKeyParameterName,
          Value: 'secure-placeholder', // Default placeholder value
          Type: 'SecureString',
          Overwrite: true,
        },
        physicalResourceId: customResources.PhysicalResourceId.of(sendGridAPIKeyParameterName),
      },
      onDelete: {
        service: 'SSM',
        action: 'deleteParameter',
        parameters: {
          Name: sendGridAPIKeyParameterName,
        },
      },
      policy: customResources.AwsCustomResourcePolicy.fromSdkCalls({
        resources: customResources.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    });

    const sendGridEmailSenderLambda = new NodejsFunction(this, `${this.stackName}-email-sender-lambda`, {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, 'lambdas/sendgrid-email-sender.ts'),
      handler: 'handler',
      timeout: Duration.seconds(30),
      environment: {
        EMAIL_USER_INVITE_SUBJECT: 'Invite from ACME',
        EMAIL_USER_VERIFICATION_SUBJECT: 'User verification from ACME',
        EMAIL_NO_REPLY_ADDRESS: props.noReplyEmailAddress,
        SSM_KEY_SENDGRID_API_KEY_ARN: sendGridAPIKeyParameterName,
        KMS_KEYS_COGNITO_TRIGGERS_CMK_NAME: cognitoTriggersCmk.keyArn,
      },
      bundling: {
        commandHooks: {
          beforeBundling(_inputDir: string, _outputDir: string): string[] {
            return [];
          },
          afterBundling(inputDir: string, outputDir: string): string[] {
            return [
              // Copy the templates directory to the output directory
              `cp -r ${path.join(inputDir, 'src/stacks/templates')} ${outputDir}/templates`,
            ];
          },
          beforeInstall() {
            return [];
          },
        },
      },
      onFailure: new cdk.aws_lambda_destinations.SnsDestination(failureTopic),
    });

    const userPool = new cognito.UserPool(this, `${this.stackName}-user-pool`, {
      userPoolName: `${this.stackName}-user-pool`,
      selfSignUpEnabled: true,
      mfa: cognito.Mfa.OFF,
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: false,
        requireUppercase: true,
      },
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: {
          required: true,
          mutable: false,
        },
      },
      customSenderKmsKey: cognitoTriggersCmk,
      lambdaTriggers: {
        customEmailSender: sendGridEmailSenderLambda,
      },
    });

    sendGridEmailSenderLambda.addPermission('SendGridEmailSenderLambdaPermission', {
      principal: new iam.ServicePrincipal('cognito-idp.amazonaws.com'),
      action: 'lambda:InvokeFunction',
    });

    sendGridEmailSenderLambda.role!.attachInlinePolicy(
      new iam.Policy(this, 'SendGridEmailSenderPolicy', {
        statements: [
          new iam.PolicyStatement({
            actions: ['kms:Decrypt', 'kms:DescribeKey'],
            effect: iam.Effect.ALLOW,
            resources: [cognitoTriggersCmk.keyArn],
          }),
          new iam.PolicyStatement({
            actions: ['cognito-idp:AdminSetUserPassword'],
            effect: iam.Effect.ALLOW,
            resources: [userPool.userPoolArn],
          }),
          new iam.PolicyStatement({
            actions: ['ssm:GetParameter'],
            effect: iam.Effect.ALLOW,
            resources: ['*'],
          }),
        ],
      }),
    );

    const webAppClient = new cognito.UserPoolClient(this, `${this.stackName}-user-pool-client`, {
      userPool: userPool,
      userPoolClientName: `${this.stackName}-web-app-client`,
      authFlows: {
        adminUserPassword: true,
        userPassword: true,
        userSrp: true,
      },
      idTokenValidity: Duration.minutes(60),
      accessTokenValidity: Duration.minutes(60),
      refreshTokenValidity: Duration.days(30),
      preventUserExistenceErrors: true,
      generateSecret: false,
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        callbackUrls: [
          'http://localhost:3000/callback',
        ],
        logoutUrls: [
          'http://localhost:3000/logout',
        ],
      },
    });

    const identityPool = new cognito.CfnIdentityPool(this, `${this.stackName}-identity-pool`, {
      identityPoolName: `${this.stackName}-identity-pool`,
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: webAppClient.userPoolClientId,
          providerName: userPool.userPoolProviderName,
        },
      ],
    });

    const userRole = new iam.Role(this, `${this.stackName}-user-role`, {
      assumedBy: new iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
        'StringEquals': { 'cognito-identity.amazonaws.com:aud': identityPool.ref },
        'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'authenticated' },
      }, 'sts:AssumeRoleWithWebIdentity'),
      inlinePolicies: {
        CognitoUserRolePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                'cognito-idp:Get*',
                'cognito-idp:Describe*',
                'cognito-idp:ChangePassword',
                'cognito-idp:ConfirmForgotPassword',
                'cognito-idp:ConfirmSignUp',
                'cognito-idp:ForgotPassword',
                'cognito-idp:GlobalSignOut',
                'cognito-idp:InitiateAuth',
                'cognito-idp:ResendConfirmationCode',
                'cognito-idp:RespondToAuthChallenge',
                'cognito-idp:SignUp',
              ],
              resources: ['*'],
              effect: iam.Effect.ALLOW,
            }),
          ],
        }),
      },
    });

    // Example Cognito Role Identity Pool attachment
    new cognito.CfnIdentityPoolRoleAttachment(this, `${this.stackName}-cognito-identity-roles`, {
      identityPoolId: identityPool.ref,
      roles: {
        authenticated: userRole.roleArn,
      },
    });

    Tags.of(this).add('role', 'auth');

  }
}
