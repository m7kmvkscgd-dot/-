const EGG_HATCH_MS = 1 * 60 * 1000;
const CHILD_GROW_MS = 3 * 60 * 1000;

async function redisGet(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL + '/get/' + encodeURIComponent(key);
  const res = await fetch(url, {
    headers: { Authorization: 'Bearer ' + process.env.UPSTASH_REDIS_REST_TOKEN }
  });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function redisSet(key, value) {
  const url = process.env.UPSTASH_REDIS_REST_URL + '/set/' + encodeURIComponent(key);
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.UPSTASH_REDIS_REST_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(JSON.stringify(value)),
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, city, userId } = req.body || {};

  if (!userId || !city) {
    return res.status(400).json({ error: 'userId and city are required' });
  }

  if (action === 'pickup') {
    const existingEgg = await redisGet('egg:' + userId + ':' + city);
    if (existingEgg) {
      return res.status(200).json({ status: 'already_have_egg', egg: existingEgg });
    }
    const egg = {
      city,
      userId,
      pickedAt: Date.now(),
      hatchAt: Date.now() + EGG_HATCH_MS,
      growAt: Date.now() + EGG_HATCH_MS + CHILD_GROW_MS,
      stage: 'egg',
    };
    await redisSet('egg:' + userId + ':' + city, egg);
    return res.status(200).json({ status: 'egg_picked', egg });
  }

  if (action === 'check') {
    const egg = await redisGet('egg:' + userId + ':' + city);
    if (!egg) {
      return res.status(200).json({ status: 'no_egg' });
    }
    const now = Date.now();
    if (now < egg.hatchAt) {
      return res.status(200).json({ status: 'egg', egg, remainingMs: egg.hatchAt - now });
    }
    if (now < egg.growAt) {
      return res.status(200).json({ status: 'child', egg, remainingMs: egg.growAt - now });
    }
    return res.status(200).json({ status: 'adult', egg });
  }

  return res.status(400).json({ error: 'Invalid action' });
};
