# Smart search dictionary: entries for a native speaker to check

Date: 2026-11-02. Source: `apps/customer-app/src/blynk/search/dictionary.ts` (every entry below carries a `// NATIVE REVIEW` marker there).

The smart search reads what a customer types (English letters, Sinhala, Tamil) and also searches the English word it stands for, so a wrong Sinhala or Tamil spelling here
only means that spelling finds nothing; it cannot break anything else. Please mark each row ok, fix the spelling, or say remove, then the developer updates the dictionary.
All other entries were written only from words the team is confident about (unsure words were left out, not guessed).

How to read it: "English" is the word a product name is expected to contain; "Singlish" are the English-letter spellings people type; Sinhala / Tamil are the script spellings.
Spellings are compared after normalisation (long and short vowels, zero-width joiners and a few look-alike letters are treated as the same), so only genuinely different spellings need listing.
One rule to confirm: salt is ලුණු (short u) and onion is ලූණු (long u); the search keeps them apart, so people who type the same letters for both will get salt for "lunu" and onion only for loku lunu / rathu lunu / bombay.

22 entries.

| English | Singlish | Sinhala | Tamil | Status |
|---|---|---|---|---|
| nadu rice | nadu, naadu | නාඩු | - | needs native check: Sinhala spelling of nadu |
| keeri samba | kiri samba, keerisamba | කීරි සම්බා | - | needs native check: Sinhala spelling of keeri samba |
| red rice | rathu haal, rathu hal, red raw rice, raw rice, kekulu, kekulu haal | රතු හාල්, කැකුළු හාල් | - | needs native check: Sinhala spellings |
| noodles | noodle, nuddals, nudles | නූඩ්ල්ස් | நூடுல்ஸ் | needs native check: loanword spelling in script |
| vanilla | vanila, vanilla essence | වැනිලා | - | needs native check: Sinhala spelling of vanilla |
| soya | soy, soya meat, soya chunks, soy chunks | සෝයා | - | needs native check: Sinhala spelling of soya |
| curd | mee kiri, meekiri, curds, dahi, thayir, tahir | මී කිරි | தயிர் | needs native check: Sinhala මී කිරි (buffalo curd) |
| butter | bata, vennai, butar | බටර් | வெண்ணெய் | needs native check: loanword spelling in script |
| cake | cakes, kek, keku | කේක් | கேக் | needs native check: loanword spelling in script |
| biscuit | biscuits, biskut, biskot, biscut, bisquit, cookies, cookie | බිස්කට් | பிஸ்கட் | needs native check: loanword spelling in script |
| vegetables | elavalu, elawalu, kaikari, vegetable, veg, veggies | එළවළු | காய்கறி | needs native check: Sinhala spelling of elawalu |
| onion | loku lunu, rathu lunu, bombay, bombay onion, big onion, red onion, vengayam, sinna vengayam, onions | ලොකු ලූණු, රතු ලූණු, ලූණු | வெங்காயம், சின்ன வெங்காயம் | needs native check: ලූණු (long u, onion) vs ලුණු (short u, salt) are often typed the same |
| carrot | carrots, karat, carot | කැරට් | கேரட் | needs native check: loanword spelling in script |
| beetroot | beet root, beets, bitroot | බීට්රූට් | பீட்ரூட் | needs native check: loanword spelling in script |
| leafy greens | kola, keera, keerai, greens, leafy vegetables | කොළ | கீரை | needs native check: bare කොළ means any leaf |
| fruits | palathuru, palaturu, fruit, pazham | පලතුරු | பழங்கள் | needs native check: Sinhala spelling of palathuru |
| jackfruit | kos, polos, palakkai, jak | කොස්, පොළොස් | பலாப்பழம் | needs native check: පොළොස් (young jak) spelling |
| chicken | kukul mas, kukulmas, kukul, kozhi, kozhi erachi, kozhi irachi, chiken, chickin | කුකුල් මස්, කුකුළු මස් | கோழி, கோழி இறைச்சி | needs native check: Sinhala කුකුළු මස් variant |
| pandan | rampe, rambai, pandan leaves | රම්පෑ | - | needs native check: Sinhala spelling of rampe |
| chocolate | chocolates, choclate, chocolat, sokalat | චොකලට් | சாக்லேட் | needs native check: loanword spelling in script |
| ice cream | icecream, ice creams, ais cream | අයිස්ක්‍රීම් | - | needs native check: Sinhala spelling of ice cream |
| shampoo | shampu, shampoos | ෂැම්පු | ஷாம்பு | needs native check: loanword spelling in script |
