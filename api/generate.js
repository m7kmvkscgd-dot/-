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

    // Child: 1 move whose type matches the monster's own type
    const childMovesNote = ' Give it exactly 1 move. The move type MUST match the monster\'s own type exactly. Give it "light" weight (power 60-90, hiragana-leaning name) befitting a child form. Format: "moves":[{"name":"わざ名","type":"モンスターのtypesと同じタイプ","weight":"light","power":65,"strong_against":["タイプ1"]}]';

    // Type-based visual direction parameters
    const TYPE_CUTE_PROB = { '火':0.30,'水':0.60,'木':0.70,'雷':0.40,'雲':0.65,'土':0.20,'氷':0.50,'鉄':0.25,'念':0.55 };
    const TYPE_COLOR_HINT = {
      '火':'red and orange', '水':'blue and cyan', '木':'green',
      '雷':'yellow and gold', '雲':'white and light blue', '土':'brown and earthy tan',
      '氷':'white and pale ice blue', '鉄':'silver and steel grey', '念':'purple and pink'
    };

    // Body build: light 20% / medium 60% / heavy 20%
    const BUILD_DESC = {
      heavy:  'heavy build: large and stocky — broad body, thick limbs, imposing physical presence. Stats tendency: HP and DEF lean high, SPD leans low.',
      medium: 'medium build: balanced proportions — standard body frame, moderate size. Stats tendency: no extreme bias, all stats balanced.',
      light:  'light build: small and slender — lean frame, lithe limbs, compact size. Stats tendency: SPD leans high, HP and DEF lean low.',
    };
    function rollBuild() {
      const r = Math.random();
      return r < 0.20 ? 'light' : r < 0.80 ? 'medium' : 'heavy';
    }
    // Move weight probability per build: heavy=65%heavy, medium=50/50, light=35%heavy
    function rollMoveWeight(build) {
      const p = build === 'heavy' ? 0.65 : build === 'light' ? 0.35 : 0.50;
      return Math.random() < p ? 'heavy' : 'light';
    }
    function wDesc(w) {
      return w === 'heavy'
        ? 'weight="heavy" (power 80-120, kanji-heavy imposing name like a powerful strike)'
        : 'weight="light" (power 60-90, hiragana-leaning or onomatopoeic flowing name)';
    }
    function buildMovesNote(m1w, m2w) {
      return ' Give it exactly 2 signature moves inspired by the local culture, history, or geography of ' + city + '.'
        + ' Move 1 (first in array): ' + wDesc(m1w) + '.'
        + ' Move 2 (second in array): ' + wDesc(m2w) + '.'
        + ' Each move must have a type from [火,水,木,雷,雲,土,氷,鉄,念] and 1-2 types it is strong against.'
        + ' Format: "moves":[{"name":"技名","type":"タイプ","weight":"' + m1w + '","power":' + (m1w === 'heavy' ? 100 : 70) + ',"strong_against":["タイプ1"]},{"name":"技名","type":"タイプ","weight":"' + m2w + '","power":' + (m2w === 'heavy' ? 100 : 70) + ',"strong_against":["タイプ1"]}]';
    }

    let adultMoveWeights = ['heavy', 'light'];
    let stageNote = '';
    if (isChild) {
      stageNote = 'This is the CHILD form. Make it look young, small, and cute. It should hint at what it will become as an adult but be clearly immature and less powerful. The monster must have EXACTLY 1 type (types array must have exactly one element). Write the lore in Japanese in 2-3 short sentences only.' + childMovesNote;
    } else if (childMonster) {
      // Type is known — resolve cute/fierce and build server-side
      const knownType = childMonster.types[0];
      const r = Math.random();
      const isCute = r < (TYPE_CUTE_PROB[knownType] ?? 0.5);
      const styleDir = isCute
        ? 'cute and charming — chubby rounded body, large expressive friendly eyes, soft gentle expression, endearing presence'
        : 'fierce and imposing — muscular powerful silhouette, sharp defined features, intense commanding expression, legendary presence';
      const colorHint = TYPE_COLOR_HINT[knownType] || 'neutral';
      const visualNote = ' Visual personality for this adult form: ' + styleDir + '. Color palette: base the design primarily on ' + colorHint + ' tones to match its type (minor accent colors are fine). ALWAYS maintain consistent pokemon-style chibi art — same deformed proportions, same line weight — regardless of cute or fierce direction.';
      // Body build (independent axis)
      const build = rollBuild();
      const buildNote = ' Body build (INDEPENDENT of cute/fierce direction): ' + BUILD_DESC[build] + '. Combine both axes freely (e.g., heavy+cute = large and endearing; light+fierce = small but razor-sharp and dangerous).';
      // Move weights based on build
      const m1w = rollMoveWeight(build);
      const m2w = rollMoveWeight(build);
      adultMoveWeights = [m1w, m2w];
      const movesNote = buildMovesNote(m1w, m2w);
      // Move type combo (80% different types, 20% same type)
      const moveTypeRoll = Math.random();
      const moveTypeNote = moveTypeRoll < 0.80
        ? ' Move types: the first move MUST be type "' + knownType + '" (monster\'s own type). The second move MUST be a DIFFERENT type from [火,水,木,雷,雲,土,氷,鉄,念] — pick one that thematically fits the locale or concept.'
        : ' Move types: BOTH moves MUST be type "' + knownType + '" (same as the monster\'s own type — pure same-type attacker).';
      stageNote = 'This is the ADULT form. It is the evolved version of this child monster: name="' + childMonster.name + '", concept="' + childMonster.concept + '", types=' + JSON.stringify(childMonster.types) + '. The adult must look like a clear evolution of the child - same general theme, but larger, more powerful, and more detailed. Keep the same concept and types as the child. Give the adult a NEW katakana name: it must feel clearly related to the child name "' + childMonster.name + '" (share a root, sound, or theme) but sound stronger, more evolved, and more legendary — remove any childish or diminutive feel and make it sound imposing and powerful. Do NOT reuse the child name as-is. Keep the same concept and types as the child. Write a NEW lore in Japanese in 2-3 short sentences only - do NOT copy the child lore. Write something more legendary and powerful befitting an adult form.' + visualNote + buildNote + movesNote + moveTypeNote;
    } else {
      // Type unknown — pass random seed so AI self-applies the cute/fierce table
      const r = Math.random().toFixed(3);
      const visualTableNote = ' Visual design: a pre-rolled random value (' + r + ') is provided. After choosing the monster\'s type, compare this value to the cute threshold for that type (火:0.30, 水:0.60, 木:0.70, 雷:0.40, 雲:0.65, 土:0.20, 氷:0.50, 鉄:0.25, 念:0.55) — if the value is BELOW the threshold design cute style (chubby rounded body, large friendly eyes, soft gentle expression); if ABOVE design fierce style (muscular silhouette, sharp features, intense expression). ALWAYS maintain pokemon-style chibi art (same deformed proportions and line weight) regardless of cute or fierce direction. Color palette must strongly reflect the chosen type: 火=red/orange, 水=blue/cyan, 木=green, 雷=yellow/gold, 雲=white/light blue, 土=brown/earthy tan, 氷=white/pale ice blue, 鉄=silver/steel grey, 念=purple/pink (accent colors allowed but base tone must match).';
      // Body build (independent axis)
      const build = rollBuild();
      const buildNote = ' Body build (INDEPENDENT of cute/fierce direction): ' + BUILD_DESC[build] + '. Combine both axes freely (e.g., heavy+cute = large and endearing; light+fierce = small but razor-sharp and dangerous).';
      // Move weights based on build
      const m1w = rollMoveWeight(build);
      const m2w = rollMoveWeight(build);
      adultMoveWeights = [m1w, m2w];
      const movesNote = buildMovesNote(m1w, m2w);
      // Move type combo (seed-based, AI self-applies)
      const moveTypeRoll = Math.random().toFixed(3);
      const moveTypeNote = ' Move type combination: pre-rolled value (' + moveTypeRoll + '). If value < 0.80: first move = monster\'s own type, second move = a DIFFERENT type from [火,水,木,雷,雲,土,氷,鉄,念] that fits the locale or concept. If value >= 0.80: BOTH moves must be the monster\'s own type.';
      stageNote = 'This is the ADULT form. Make it look mature and fully evolved. The monster must have EXACTLY 1 type (types array must have exactly one element). Write the lore in Japanese in 2-3 short sentences only.' + visualTableNote + buildNote + movesNote + moveTypeNote;
    }

    const baseFormat = '{"name":"katakana monster name","emoji":"single emoji","city":"' + city + '","concept":"concept in Japanese","types":["type1"],"stats":{"hp":100,"atk":50,"def":40,"spd":35},"weatherStrong":["clear","rain"],"weatherWeak":["snow","thunder"],"promptEn":["feature1","feature2","feature3","512x512px square format, soft gradient background NOT transparent, pokemon-style cute chibi character centered taking 70% of image, simple beautiful background with nature or environment elements matching the monster type, Japanese anime RPG game art","color palette and mood"],"lore":"lore in Japanese 2-3 sentences","moves":[{"name":"わざ名","type":"タイプ","weight":"light","power":65,"strong_against":["タイプ1"]}]}';

    const adultFormat = '{"name":"katakana monster name","emoji":"single emoji","city":"' + city + '","concept":"concept in Japanese","types":["type1"],"stats":{"hp":100,"atk":50,"def":40,"spd":35},"weatherStrong":["clear","rain"],"weatherWeak":["snow","thunder"],"promptEn":["feature1","feature2","feature3","512x512px square format, soft gradient background NOT transparent, pokemon-style cute chibi character centered taking 70% of image, simple beautiful background with nature or environment elements matching the monster type, Japanese anime RPG game art","color palette and mood"],"lore":"lore in Japanese 2-3 sentences","moves":[{"name":"技名","type":"タイプ","weight":"' + adultMoveWeights[0] + '","power":' + (adultMoveWeights[0] === 'heavy' ? 100 : 70) + ',"strong_against":["タイプ1"]},{"name":"技名","type":"タイプ","weight":"' + adultMoveWeights[1] + '","power":' + (adultMoveWeights[1] === 'heavy' ? 100 : 70) + ',"strong_against":["タイプ1"]}]}';

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
