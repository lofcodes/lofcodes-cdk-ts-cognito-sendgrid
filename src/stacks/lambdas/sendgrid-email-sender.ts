import * as fs from 'fs';
import * as path from 'path';
import {
  buildClient,
  CommitmentPolicy,
  KmsKeyringNode,
  DecryptOutput,
} from '@aws-crypto/client-node';
import { CognitoIdentityProviderClient, AdminSetUserPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { fromBase64 } from '@aws-sdk/util-base64-node';
import * as sgMail from '@sendgrid/mail';
import * as ejs from 'ejs';

import { CognitoCustomEmailSenderHandler } from './types';

const keyArn = process.env.KMS_KEYS_COGNITO_TRIGGERS_CMK_NAME;
const emailNoReplyAddress: string = process.env.EMAIL_NO_REPLY_ADDRESS || 'noreply@email.com';
const emailUserVerificationSubject: string = process.env.EMAIL_NO_REPLY_ADDRESS || 'Your Verification Code';
const emailUserInviteSubject: string = process.env.EMAIL_NO_REPLY_ADDRESS || 'Your ACME Hub registration details';
const sendgridAPIKeyParamName = process.env.SSM_KEY_SENDGRID_API_KEY_ARN;
const region = process.env.ENV_REGION;

if (typeof keyArn !== 'string' || keyArn.trim() === '') {
  throw new Error(`Invalid KMS key ARN ${keyArn}`);
}

const ssmClient = new SSMClient({ region: region });

const keyring = new KmsKeyringNode({
  generatorKeyId: keyArn,
  keyIds: [keyArn],
});

const { decrypt } = buildClient(
  CommitmentPolicy.FORBID_ENCRYPT_ALLOW_DECRYPT,
);

export const handler: CognitoCustomEmailSenderHandler = async (event, context, callback) => {
  console.log(`Received event: ${JSON.stringify(event)}`);
  const { userPoolId, triggerSource, request } = event;
  const email = request.userAttributes.email;
  let plainTextCode: Uint8Array | undefined;

  if (request.code) {
    try {
      const decryptResult: DecryptOutput = await decrypt(
        keyring,
        fromBase64(request.code),
      );
      plainTextCode = decryptResult.plaintext;
    } catch (error) {
      console.error(`Error decrypting code for ${email}:`, error);
      plainTextCode = undefined; // fallback to undefined on decryption failure
    }
  }

  try {
    switch (triggerSource) {
      case 'CustomEmailSender_SignUp':
      case 'CustomEmailSender_ForgotPassword':
      case 'CustomEmailSender_ResendCode':
        await handleUserVerification(email, plainTextCode, callback, event);
        break;

      case 'CustomEmailSender_AdminCreateUser':
        await handleUserInvite(userPoolId, email, callback, event);
        break;

      default:
        console.log('No cognito trigger source found, nothing to do.');
        callback(null, event);
        break;
    }
  } catch (error) {
    console.error(`Error processing event for ${email}:`, error);
    callback(error as Error); // Report any unhandled errors
  }
};

async function handleUserVerification(email: string, plainTextCode: Uint8Array | undefined, callback: any, event: any) {
  try {
    const sendGridApiKey = await getSSMParameterValue(sendgridAPIKeyParamName!);
    sgMail.setApiKey(sendGridApiKey);

    const body = await renderTemplate('userVerification.ejs', {
      verificationCode: plainTextCode?.toString() || 'Error - Contact Administrator',
    });

    await sendEmailWithSendGrid(email, emailUserVerificationSubject, body);
    console.log(`Verification email sent to ${email}`);
    callback(null, event);
  } catch (error) {
    console.error(`Error sending verification email to ${email}:`, error);
    callback(error);
  }
}

async function handleUserInvite(userPoolId: string, email: string, callback: any, event: any) {
  try {
    await adminSetPassword(email, userPoolId);

    const sendGridApiKey = await getSSMParameterValue(sendgridAPIKeyParamName!);
    sgMail.setApiKey(sendGridApiKey);

    const body = await renderTemplate('userInvite.ejs', {
      userIdentifier: email,
    });

    await sendEmailWithSendGrid(email, emailUserInviteSubject, body);
    console.log(`Invite email sent to ${email}`);
    callback(null, event);
  } catch (error) {
    console.error(`Error sending invite email to ${email}:`, error);
    callback(error);
  }
}

function generateRandomPassword(length = 8): string {
  const charSets = [
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ', // Uppercase
    'abcdefghijklmnopqrstuvwxyz', // Lowercase
    '0123456789', // Numbers
    '!@#$%^&*()_+[]{}|;:,.<>?', // Special characters
  ];

  // Ensure at least one character from each set
  const initialChars = charSets.map(
    (set) => set[Math.floor(Math.random() * set.length)],
  );

  // Fill the remaining characters randomly from all sets combined
  const allChars = charSets.join('');
  const remainingChars = Array.from({ length: length - initialChars.length },
    () => allChars[Math.floor(Math.random() * allChars.length)],
  );

  // Shuffle the final array to ensure randomness
  const passwordArray = [...initialChars, ...remainingChars].sort(() => Math.random() - 0.5);

  return passwordArray.join('');
}

/**
 * This is required as custom email sending cannot access the password set
 * Setting the password pseudo-permanently allows the invitee to follow the forgot password flow to set their password
 * */
async function adminSetPassword(email: string, userPoolId: string) {
  const command = new AdminSetUserPasswordCommand({
    Username: email,
    UserPoolId: userPoolId,
    Password: generateRandomPassword(),
    Permanent: true,
  });

  try {
    const cognito = new CognitoIdentityProviderClient({ region: region });
    const response = await cognito.send(command);
    console.log(`Permanent password set successfully for user ${email}:`, response);
  } catch (error) {
    console.error(`Error setting permanent password for user ${email}:`, error);
  }
}

async function getSSMParameterValue(parameterName: string): Promise<string> {
  try {
    const command = new GetParameterCommand({ Name: parameterName, WithDecryption: true });
    const result = await ssmClient.send(command);

    if (!result.Parameter?.Value) {
      throw new Error(`SSM parameter ${parameterName} is empty or not found`);
    }

    return result.Parameter?.Value || '';
  } catch (error) {
    console.error(`Error retrieving SSM parameter ${parameterName}:`, error);
    throw error;
  }
}

async function sendEmailWithSendGrid(to: string, subject: string, body: string): Promise<void> {
  const msg = {
    to: to,
    from: emailNoReplyAddress,
    subject: subject,
    html: body,
  };

  try {
    await sgMail.send(msg);
    console.log(`Email sent to ${to} with subject "${subject}"`);
  } catch (error) {
    console.error(`Error sending email to ${to}:`, error);
    throw error;
  }
}

async function renderTemplate(templateName: string, data: object): Promise<string> {
  try {
    const template = fs.readFileSync(path.join(__dirname, 'templates', templateName), 'utf-8');
    return ejs.render(template, data);
  } catch (error) {
    console.error(`Error rendering template ${templateName}:`, error);
    throw error;
  }
}
