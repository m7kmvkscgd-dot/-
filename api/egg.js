const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const EGG_HATCH_MS = 5 * 60 * 60 * 1000;      // 5時間
const CHILD_GROW_MS = 24 * 60 * 60 * 1000;     // 24時間

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, city, userId } = req.body || {};

  if (!userId || !city) {
    return res.status(400).json({ error: 'userId and city are required' });
  }

  // 卵を拾う
  if (action === 'pickup') {
    const existingEgg = await redis.get('egg:' + userId + ':' + city);
    if (existingEgg) {
      return res.status(200).json({ status: 'already_have_egg', egg: existingEgg });
    }
    const existingMonster = await redis.get('monster:' + city);
    if (existingMonster) {
      return res.status(200).json({ status: 'already_generated', monster: existingMonster });
    }
    const egg = {
      city,
      userId,
      pickedAt: Date.now(),
      hatchAt: Date.now() + EGG_HATCH_MS,
      growAt: Date.now() + EGG_HATCH_MS + CHILD_GROW_MS,
      stage: 'egg',
    };
    await redis.set('egg:' + userId + ':' + city, egg);
    return res.status(200).json({ status: 'egg_picked', egg });
  }

  // 孵化・成長チェック
  if (action === 'check') {
    const egg = await redis.get('egg:' + userId + ':' + city);
    if (!egg) {
      return res.status(200).json({ status: 'no_egg' });
    }
    const now = Date.now();

    // まだ卵
    if (now < egg.hatchAt) {
      return res.status(200).json({
        status: 'egg',
        egg,
        remainingMs: egg.hatchAt - now,
      });
    }

    // 子供段階
    if (now < egg.growAt) {
      const monster = await redis.get('monster:child:' + city);
      return res.status(200).json({
        status: 'child',
        egg,
        monster: monster || null,
        remainingMs: egg.growAt - now,
      });
    }

    // 大人段階
    const monster = await redis.get('monster:adult:' + city);
    return res.status(200).json({
      status: 'adult',
      egg,
      monster: monster || null,
    });
  }

  return res.status(400).json({ error: 'Invalid action' });
};
