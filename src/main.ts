import { App } from 'aws-cdk-lib';
import { CognitoSendGridStack } from './stacks/cognito-sendgrid-stack';
import { DeploymentStage } from './types';

const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();

new CognitoSendGridStack(app, 'firstblox-cdk-ts-cognito-sendgrid-dev', {
  env: devEnv,
  stage: DeploymentStage.DEV,
  applicationName: 'cognito-sendgrid-poc', // TODO: replace with your application name. Resources like SSM param names interpolate this.
  noReplyEmailAddress: 'noreply@firstblox.com', // TODO: Replace with a noreply email address validated in SendGrid.
  errorNotificationEmail: 'lorcan@firstblox.com' // TODO: Replace with email address to receive failure events from Cognito Lambda trigger.
});

app.synth();