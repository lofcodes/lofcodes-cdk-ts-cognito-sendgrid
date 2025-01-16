import * as cdk from 'aws-cdk-lib';

export interface CognitoSendGridStackProps extends cdk.StackProps {
  stage: DeploymentStage;
  applicationName: string;
  noReplyEmailAddress: string;
  errorNotificationEmail: string;
}

export enum DeploymentStage {
  DEV = 'dev',
  OPS = 'ops',
  QA = 'qa',
  STAGE = 'stage',
  PROD = 'prod',
}