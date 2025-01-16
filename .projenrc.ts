import { awscdk } from 'projen';
const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: '2.1.0',
  defaultReleaseBranch: 'main',
  name: 'firstblox-cdk-ts-cognito-sendgrid',
  projenrcTs: true,
  devDeps: [
    '@types/aws-lambda',
    'aws-lambda',
  ],
  deps: [
    'ejs',
    '@types/ejs',
    '@aws-sdk/client-cognito-identity-provider',
    '@aws-crypto/client-node',
    '@aws-sdk/client-ssm',
    '@aws-sdk/util-base64-node',
    '@sendgrid/mail',
  ],
});

project.synth();