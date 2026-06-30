const { put } = require('@vercel/blob');

async function redisGet(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL + '/get/' + encodeURIComponent(key);
  const res = await fetch(url, {
    headers: { Authorization: 'Bearer ' + process.env.UPSTASH_REDIS_REST_TOKEN }
  });
  const data = await res.json();
  if (!data.result) return null;
  return JSON.parse(data.result);
}

async function redisSet(key, value) {
  const url = process.env.UPSTASH_REDIS_REST_URL + '/set/' + encodeURIComponent(key);
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.UPSTASH_REDIS_REST_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(value),
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { city, weatherInfo, stage, childMonster } = req.body;
  if (!city) {
    return res.status(400).json({ error: 'City is required' });
  }

  const cacheKey = 'monster:' + (stage || 'adult') + ':' + city;
  const cached = await redisGet(cacheKey);
  if (cached) {
    return res.status(200).json(cached);
  }

  try {
    const weather = weatherInfo || 'unknown';
    const isChild = stage === 'child';
    // Adult: 2 moves, one heavy (kanji-heavy name, 80-120 power) + one light (hiragana-leaning name, 60-90 power)
    const movesNote = ' Give it exactly 2 signature moves inspired by the local culture, history, or geography of ' + city + '. One move MUST be "heavy" weight (power 80-120, give it a kanji-heavy imposing name like a powerful strike) and one MUST be "light" weight (power 60-90, give it a hiragana-leaning or onomatopoeic flowing name like a swift technique). Each move must have a type from [火,水,木,雷,雲,土,氷,鉄,念] and 1-2 types it is strong against. Format: "moves":[{"name":"重技名","type":"タイプ","weight":"heavy","power":100,"strong_against":["タイプ1"]},{"name":"かるわざ","type":"タイプ","weight":"light","power":70,"strong_against":["タイプ1"]}]';

    // Child: 1 move whose type matches the monster's own type
    const childMovesNote = ' Give it exactly 1 move. The move type MUST match the monster\'s own type exactly. Give it "light" weight (power 60-90, hiragana-leaning name) befitting a child form. Format: "moves":[{"name":"わざ名","type":"モンスターのtypesと同じタイプ","weight":"light","power":65,"strong_against":["タイプ1"]}]';

    let stageNote = '';
    if (isChild) {
      stageNote = 'This is the CHILD form. Make it look young, small, and cute. It should hint at what it will become as an adult but be clearly immature and less powerful. The monster must have EXACTLY 1 type (types array must have exactly one element). Write the lore in Japanese in 2-3 short sentences only.' + childMovesNote;
    } else if (childMonster) {
      stageNote = 'This is the ADULT form. It is the evolved version of this child monster: name="' + childMonster.name + '", concept="' + childMonster.concept + '", types=' + JSON.stringify(childMonster.types) + '. The adult must look like a clear evolution of the child - same color scheme, same general theme, but larger, more powerful, and more detailed. Keep the same concept and types as the child. Give the adult a NEW katakana name: it must feel clearly related to the child name "' + childMonster.name + '" (share a root, sound, or theme) but sound stronger, more evolved, and more legendary — remove any childish or diminutive feel and make it sound imposing and powerful. Do NOT reuse the child name as-is. Keep the same concept and types as the child. Write a NEW lore in Japanese in 2-3 short sentences only - do NOT copy the child lore. Write something more legendary and powerful befitting an adult form.' + movesNote;
    } else {
      stageNote = 'This is the ADULT form. Make it look mature, powerful, and fully evolved. The monster must have EXACTLY 1 type (types array must have exactly one element). Write the lore in Japanese in 2-3 short sentences only.' + movesNote;
    }

    const baseFormat = '{"name":"katakana monster name","emoji":"single emoji","city":"' + city + '","concept":"concept in Japanese","types":["type1"],"stats":{"hp":100,"atk":50,"def":40,"spd":35},"weatherStrong":["clear","rain"],"weatherWeak":["snow","thunder"],"promptEn":["feature1","feature2","feature3","512x512px square format, soft gradient background NOT transparent, pokemon-style cute chibi character centered taking 70% of image, simple beautiful background with nature or environment elements matching the monster type, Japanese anime RPG game art","color palette and mood"],"lore":"lore in Japanese 2-3 sentences","moves":[{"name":"わざ名","type":"タイプ","weight":"light","power":65,"strong_against":["タイプ1"]}]}';

    const adultFormat = '{"name":"katakana monster name","emoji":"single emoji","city":"' + city + '","concept":"concept in Japanese","types":["type1"],"stats":{"hp":100,"atk":50,"def":40,"spd":35},"weatherStrong":["clear","rain"],"weatherWeak":["snow","thunder"],"promptEn":["feature1","feature2","feature3","512x512px square format, soft gradient background NOT transparent, pokemon-style cute chibi character centered taking 70% of image, simple beautiful background with nature or environment elements matching the monster type, Japanese anime RPG game art","color palette and mood"],"lore":"lore in Japanese 2-3 sentences","moves":[{"name":"重技名","type":"タイプ","weight":"heavy","power":100,"strong_against":["タイプ1"]},{"name":"かるわざ","type":"タイプ","weight":"light","power":70,"strong_against":["タイプ1"]}]}';

    const content = 'You are a game designer. Design a local monster for the Japanese city of ' + city + '. Research its history, geography, local specialties, legends, and modern characteristics. Current weather at player location: ' + weather + '. ' + stageNote + ' Output ONLY a valid JSON object with no explanation, no markdown, no code blocks. The JSON must use double quotes only. Format: ' + (isChild ? baseFormat : adultFormat);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: content }],
      }),
    });

    const claudeData = await claudeRes.json();
    if (!claudeData.content || !claudeData.content[0]) {
      return res.status(500).json({ error: 'No response from Claude API' });
    }
    const text = claudeData.content[0].text;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return res.status(500).json({ error: 'No JSON found in response' });
    }
    let monster = JSON.parse(match[0]);
    monster.stage = stage || 'adult';

    // Enforce single type
    if (Array.isArray(monster.types) && monster.types.length > 1) {
      monster.types = [monster.types[0]];
    }

    if (isChild) {
      // Enforce exactly 1 move with type matching monster's type
      const monsterType = monster.types && monster.types[0];
      if (!monster.moves || monster.moves.length === 0) {
        monster.moves = [{ name: 'たいあたり', type: monsterType || '念', weight: 'light', power: 65, strong_against: [] }];
      } else {
        monster.moves = [monster.moves[0]];
        if (monsterType) monster.moves[0].type = monsterType;
      }
    }

    if (!isChild && childMonster) {
      monster.concept = childMonster.concept;
      monster.types = childMonster.types;
      monster.emoji = childMonster.emoji;
    }

    try {
      const imagePrompt = (monster.promptEn || []).join(', ');
      const imageRes = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY,
        },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt: imagePrompt,
          n: 1,
          size: '1024x1024',
          quality: 'medium',
        }),
      });
      const imageData = await imageRes.json();
      if (imageData.data && imageData.data[0] && imageData.data[0].b64_json) {
        const b64 = imageData.data[0].b64_json;
        const buffer = Buffer.from(b64, 'base64');
        const fileName = 'monsters/' + city.replace(/[^\w]/g, '') + '_' + (stage || 'adult') + '.png';
        const { url } = await put(fileName, buffer, {
          access: 'public',
          contentType: 'image/png',
        });
        monster.imageUrl = url;
      }
    } catch (imgError) {
      monster.imageError = imgError.message;
    }

    await redisSet(cacheKey, monster);
    return res.status(200).json(monster);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
