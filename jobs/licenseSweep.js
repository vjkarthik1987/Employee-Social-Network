const Company = require('../models/Company');
const { sendMail } = require('../services/mailer');

async function licenseSweep({ now = new Date() } = {}) {
  const soon = new Date(now); soon.setDate(soon.getDate()+7);
  const three = new Date(now); three.setDate(three.getDate()+3);

  // Reminders for trials ending soon
  const dueSoon = await Company.find({
    planState: 'FREE_TRIAL',
    trialEndsAt: { $gte: now, $lte: soon },
    'policies.notificationsEnabled': true
  }).lean();

  await Promise.allSettled(dueSoon.map(async c => {
    // send reminder to tenant admins (simplify: all users with role=ORG_ADMIN)
    const admins = await require('../models/User').find({ companyId: c._id, role: 'ORG_ADMIN' }).lean();
    const subject = `Trial ends soon — ${c.name}`;
    const html = `<div style="font-family:system-ui"><h2>Your free trial ends on ${c.trialEndsAt.toDateString()}</h2>
    <p>Upgrade or request an extension to keep inviting users.</p></div>`;
    return Promise.allSettled(admins.map(a => a.email && sendMail({ to: a.email, subject, html })));
  }));

  // Expire trials that passed
  const expired = await Company.find({
    planState: 'FREE_TRIAL',
    trialEndsAt: { $lt: now }
  });
  for (const c of expired) {
    c.planState = 'EXPIRED';
    await c.save();
  }
}

module.exports = { licenseSweep };
