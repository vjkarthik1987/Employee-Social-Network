require('dotenv').config();
const nodemailer = require('nodemailer');

(async () => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  try {
    const info = await transporter.sendMail({
      from: `"SunTec Engage" <${process.env.SMTP_FROM}>`,
      to: process.env.SMTP_FROM,
      subject: 'SMTP test ✔',
      text: 'If you received this, Office 365 SMTP works!'
    });
    console.log('Mail sent:', info.messageId);
  } catch (err) {
    console.error('Mail failed:', err);
  }
})();
