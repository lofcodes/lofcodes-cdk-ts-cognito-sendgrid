import { Callback, Context } from 'aws-lambda';

interface CognitoCustomEmailSenderEvent {
  version: string;
  triggerSource:
  | 'CustomEmailSender_SignUp'
  | 'CustomEmailSender_ResendCode'
  | 'CustomEmailSender_ForgotPassword'
  | 'CustomEmailSender_UpdateUserAttribute'
  | 'CustomEmailSender_VerifyUserAttribute'
  | 'CustomEmailSender_AdminCreateUser'
  | 'CustomEmailSender_AccountTakeOverNotification';
  region: string;
  userPoolId: string;
  userName: string;
  callerContext: {
    awsSdkVersion: string;
    clientId: string;
  };
  request: {
    type: string;
    code: string;
    clientMetadata: { [key: string]: string };
    userAttributes: { [key: string]: string };
  };
  response: {
    emailMessage: string;
    emailSubject: string;
  };
}

/*
Sample event body
{
    "version": "1",
    "triggerSource": "CustomEmailSender_AdminCreateUser",
    "region": "eu-west-1",
    "userPoolId": "eu-west--1XXXXXXXX",
    "userName": "email@example.com",
    "callerContext": {
        "awsSdkVersion": "aws-sdk-unknown-unknown",
        "clientId": "CLIENT_ID_NOT_APPLICABLE"
    },
    "request": {
        "type": "customEmailSenderRequestV1",
        "code": "XXXXXXXXXXXXXXXXXXXXXXx",
        "clientMetadata": null,
        "userAttributes": {
            "sub": "b2c53424-50c1-7026-e27a-XXXXXXXXXXXXX",
            "email_verified": "true",
            "cognito:user_status": "FORCE_CHANGE_PASSWORD",
            "custom:tenant_id": "213f709a-ce4f-413d-a0bd-XXXXXXXXXXXX",
            "custom:user_type": "staff",
            "email": "email@example.com"
        }
    }
}
*/

export type CognitoCustomEmailSenderHandler = (
  event: CognitoCustomEmailSenderEvent,
  context: Context,
  callback: Callback
) => void | Promise<void>;