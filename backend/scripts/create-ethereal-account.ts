import nodemailer from 'nodemailer';

async function createEtherealAccount() {
  console.log('Generating Ethereal SMTP test account via Nodemailer...');
  try {
    const account = await nodemailer.createTestAccount();
    console.log('\n--- Ethereal SMTP Account Created Successfully ---');
    console.log(`Email / User : ${account.user}`);
    console.log(`Password     : ${account.pass}`);
    console.log(`SMTP Host    : ${account.smtp.host}`);
    console.log(`SMTP Port    : ${account.smtp.port}`);
    console.log(`Secure       : ${account.smtp.secure}`);
    console.log(`Web Mail URL : ${account.web}`);
    console.log('\n--- Payload for POST /api/senders ---');
    console.log(
      JSON.stringify(
        {
          name: `Sender (${account.user.split('@')[0]})`,
          email: account.user,
          host: account.smtp.host,
          port: account.smtp.port,
          secure: account.smtp.secure,
          username: account.user,
          password: account.pass,
          hourly_limit: 50,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error('Failed to create Ethereal account:', error);
    process.exit(1);
  }
}

createEtherealAccount();
