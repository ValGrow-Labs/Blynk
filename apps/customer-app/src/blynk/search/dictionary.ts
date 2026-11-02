/*
 * Smart search dictionary (docs/superpowers/plans/2026-11-02-smart-search.md): the words customers type
 * for what a Sri Lankan grocery (Aluthgama / Beruwala) sells, in English letters (Singlish / Tanglish),
 * Sinhala and Tamil script, plus English synonyms and common misspellings. It is DATA, not code:
 * the matcher in smartSearch.ts turns every alias into the English word (`en`, plus `also`) a product
 * name is likely to contain.
 *
 *   en       the English word(s) products are named with (an alias too)
 *   aliases  everything a customer might type for it
 *   also     more English words to look for when `en` alone is too narrow (e.g. greens -> gotukola, kankun)
 *   note     free text for the next editor
 *
 * An entry marked `// NATIVE REVIEW` has a Sinhala or Tamil spelling (or a Singlish sense) nobody on the
 * team has checked with a native speaker yet; they are listed in docs/research/search-dictionary-review.md.
 * Spellings are compared after normalisation (normalize.ts), so long/short vowels and the usual keyboard
 * variants need no separate entries. Do not add a word you are not sure about: leave it out.
 */

export interface DictEntry {
  en: string;
  aliases: string[];
  also?: string[];
  note?: string;
}

export type DictTheme =
  | 'staples' | 'dairy' | 'bread' | 'vegetables' | 'fruit' | 'meatFishEgg' | 'spices' | 'oils'
  | 'drinks' | 'snacks' | 'baby' | 'household' | 'personalCare';

export const DICTIONARY_GROUPS: Record<DictTheme, DictEntry[]> = {
  /* ------------------------------------------------------------------ staples: sugar, salt, rice, flour, pulses, baking */
  staples: [
    { en: 'sugar', aliases: ['seeni', 'sini', 'seni', 'heeni', 'hini', 'cheeni', 'chini', 'sakkara', 'sakkarai', 'sarkarai', 'සීනි', 'සිනි', 'චීනි', 'சீனி', 'சர்க்கரை', 'சக்கரை'] },
    { en: 'icing sugar', aliases: ['icing sugar', 'castor sugar', 'powdered sugar', 'caster sugar'] },
    { en: 'salt', aliases: ['lunu', 'uppu', 'ලුණු', 'உப்பு'], note: 'Singlish lunu is SALT; onions are loku lunu / rathu lunu / bombay' },
    { en: 'rock salt', aliases: ['gal lunu', 'kal uppu', 'ගල් ලුණු', 'கல் உப்பு'] },
    { en: 'rice', aliases: ['haal', 'hal', 'haalu', 'arisi', 'bath', 'sooru', 'soru', 'හාල්', 'බත්', 'அரிசி', 'சோறு'] },
    { en: 'nadu rice', aliases: ['nadu', 'naadu', 'නාඩු'] }, // NATIVE REVIEW: Sinhala spelling of nadu
    { en: 'samba rice', aliases: ['samba', 'sambaa', 'සම්බා', 'சம்பா'] },
    { en: 'keeri samba', aliases: ['keeri samba', 'kiri samba', 'keerisamba', 'කීරි සම්බා'] }, // NATIVE REVIEW: Sinhala spelling of keeri samba
    { en: 'red rice', aliases: ['rathu haal', 'rathu hal', 'red raw rice', 'raw rice', 'kekulu', 'kekulu haal', 'රතු හාල්', 'කැකුළු හාල්'] }, // NATIVE REVIEW: Sinhala spellings
    { en: 'basmati', aliases: ['basmati', 'basmathi', 'basmatti'] },
    { en: 'suwandel', aliases: ['suwandel', 'suwandal', 'suvandel'] },
    { en: 'flour', aliases: ['piti', 'maavu', 'mavu', 'පිටි', 'மாவு'] },
    { en: 'wheat flour', aliases: ['thirigu piti', 'thirigu pitti', 'wheat flour', 'godhumai maavu', 'godumai maavu', 'තිරිඟු පිටි', 'கோதுமை மாவு'] },
    { en: 'rice flour', aliases: ['haal piti', 'hal piti', 'arisi maavu', 'rice flour', 'හාල් පිටි', 'அரிசி மாவு'] },
    { en: 'kurakkan', aliases: ['kurakkan', 'kurakkan piti', 'finger millet', 'ragi', 'කුරක්කන්'] },
    { en: 'pittu flour', aliases: ['pittu piti', 'puttu maavu', 'pittu flour', 'puttu flour'] },
    { en: 'semolina', aliases: ['rawa', 'rava', 'ravai', 'suji', 'sooji', 'semolina', 'රවා', 'ரவை'] },
    { en: 'vermicelli', aliases: ['semiya', 'sevai', 'vermicelli', 'සේමියා', 'சேமியா'] },
    { en: 'noodles', aliases: ['noodles', 'noodle', 'nuddals', 'nudles', 'නූඩ්ල්ස්', 'நூடுல்ஸ்'] }, // NATIVE REVIEW: loanword spelling in script
    { en: 'pasta', aliases: ['pasta', 'pastas'] },
    { en: 'macaroni', aliases: ['macaroni', 'makaroni', 'macaronie'] },
    { en: 'spaghetti', aliases: ['spaghetti', 'spagetti', 'spaghetty'] },
    { en: 'oats', aliases: ['oats', 'oatmeal', 'porridge oats', 'oates'] },
    { en: 'cornflakes', aliases: ['cornflakes', 'corn flakes', 'cereal', 'breakfast cereal', 'cornflake'] },
    { en: 'dhal', aliases: ['parippu', 'paruppu', 'dal', 'dhal', 'dhall', 'dahl', 'mysore dhal', 'පරිප්පු', 'பருப்பு'] },
    { en: 'green gram', aliases: ['mung', 'moong', 'mung ata', 'green gram', 'payaru', 'pachai payaru', 'pasi payaru', 'මුං ඇට', 'பாசிப்பயறு', 'பச்சைப்பயறு'] },
    { en: 'chickpeas', aliases: ['kadala', 'kadalai', 'chana', 'chickpea', 'chick peas', 'kondakadalai', 'කඩල', 'கொண்டைக்கடலை'] },
    { en: 'black gram', aliases: ['uludu', 'ulundu', 'urad', 'urad dhal', 'black gram', 'උඳු', 'உளுந்து'] },
    { en: 'peanuts', aliases: ['rata kaju', 'ratakaju', 'peanut', 'groundnut', 'groundnuts', 'verkadalai', 'nilakadalai', 'රටකජු', 'வேர்க்கடலை'] },
    { en: 'cashew', aliases: ['kaju', 'cashew', 'cashews', 'cashewnut', 'mundiri', 'කජු', 'முந்திரி'] },
    { en: 'jaggery', aliases: ['hakuru', 'vellam', 'karuppatti', 'kitul hakuru', 'kithul hakuru', 'jaggery', 'හකුරු', 'කිතුල් හකුරු', 'வெல்லம்', 'கருப்பட்டி'] },
    { en: 'treacle', aliases: ['pani', 'kithul pani', 'kitul pani', 'treacle', 'කිතුල් පැණි'] },
    { en: 'honey', aliases: ['mee pani', 'meepani', 'pani', 'honey', 'then', 'thaen', 'madhu', 'මී පැණි', 'தேன்'] },
    { en: 'baking powder', aliases: ['baking powder', 'bakin powder', 'bakingpowder'] },
    { en: 'baking soda', aliases: ['baking soda', 'bicarbonate of soda', 'soda bicarb'] },
    { en: 'yeast', aliases: ['yeast', 'eest', 'instant yeast'] },
    { en: 'cornflour', aliases: ['cornflour', 'corn flour', 'corn starch', 'cornstarch'] },
    { en: 'custard powder', aliases: ['custard', 'custard powder'] },
    { en: 'cocoa', aliases: ['cocoa', 'koko', 'cacao', 'cocoa powder'] },
    { en: 'vanilla', aliases: ['vanilla', 'vanila', 'vanilla essence', 'වැනිලා'] }, // NATIVE REVIEW: Sinhala spelling of vanilla
    { en: 'food colour', aliases: ['food colour', 'food color', 'food colouring', 'colouring'] },
    { en: 'sago', aliases: ['sago', 'saggu', 'sagu', 'sabudana'] },
    { en: 'tamarind', aliases: ['siyambala', 'puli', 'tamarind', 'සියඹලා', 'புளி'] },
    { en: 'soya', aliases: ['soya', 'soy', 'soya meat', 'soya chunks', 'soy chunks', 'සෝයා'] }, // NATIVE REVIEW: Sinhala spelling of soya
    { en: 'coconut milk', aliases: ['pol kiri', 'polkiri', 'thengai paal', 'coconut milk', 'පොල් කිරි', 'தேங்காய்ப் பால்'] },
    { en: 'canned food', aliases: ['canned', 'tinned', 'tin food', 'canned food'] },
  ],

  /* ------------------------------------------------------------------ dairy */
  dairy: [
    { en: 'milk', aliases: ['kiri', 'paal', 'milk', 'milc', 'කිරි', 'பால்'] },
    { en: 'milk powder', aliases: ['kiri pitti', 'kiri piti', 'kiripiti', 'kiripitti', 'paal maa', 'paal powder', 'milk powder', 'milkpowder', 'කිරි පිටි', 'කිරිපිටි', 'பால் மா', 'பால் பவுடர்'] },
    { en: 'fresh milk', aliases: ['fresh milk', 'cow milk', 'cows milk'] },
    { en: 'condensed milk', aliases: ['condensed milk', 'milkmaid', 'milk maid', 'kondensed milk'] },
    { en: 'curd', aliases: ['mee kiri', 'meekiri', 'curd', 'curds', 'dahi', 'thayir', 'tahir', 'මී කිරි', 'தயிர்'] }, // NATIVE REVIEW: Sinhala මී කිරි (buffalo curd)
    { en: 'yoghurt', aliases: ['yoghurt', 'yogurt', 'yogurth', 'yoghurth', 'yogert'] },
    { en: 'butter', aliases: ['butter', 'bata', 'vennai', 'butar', 'බටර්', 'வெண்ணெய்'] }, // NATIVE REVIEW: loanword spelling in script
    { en: 'ghee', aliases: ['ghee', 'ghi', 'ney', 'நெய்'] },
    { en: 'cheese', aliases: ['cheese', 'cheez', 'cheeze', 'cheeses'] },
    { en: 'cream', aliases: ['fresh cream', 'whipping cream', 'cooking cream'] },
    { en: 'margarine', aliases: ['margarine', 'margerine', 'margarin'] },
    { en: 'milkshake', aliases: ['milkshake', 'milk shake', 'flavoured milk', 'flavored milk'] },
    { en: 'paneer', aliases: ['paneer', 'panir'] },
  ],

  /* ------------------------------------------------------------------ bread and bakery */
  bread: [
    { en: 'bread', aliases: ['pan', 'paan', 'paanu', 'bread', 'sliced bread', 'පාන්', 'பாண்'] },
    { en: 'bun', aliases: ['banis', 'bunis', 'bun', 'buns', 'බනිස්'] },
    { en: 'roti', aliases: ['roti', 'rotti', 'godamba roti', 'godamba', 'රොටි', 'ரொட்டி'] },
    { en: 'cake', aliases: ['cake', 'cakes', 'kek', 'keku', 'කේක්', 'கேக்'] }, // NATIVE REVIEW: loanword spelling in script
    { en: 'biscuit', aliases: ['biscuit', 'biscuits', 'biskut', 'biskot', 'biscut', 'bisquit', 'cookies', 'cookie', 'බිස්කට්', 'பிஸ்கட்'] }, // NATIVE REVIEW: loanword spelling in script
    { en: 'cracker', aliases: ['cracker', 'crackers', 'cream cracker', 'kracker'] },
    { en: 'rusk', aliases: ['rusk', 'rusks', 'toast'] },
    { en: 'string hoppers', aliases: ['string hoppers', 'stringhoppers', 'idiyappam', 'idiyappa', 'idi appa', 'indi appa', 'இடியப்பம்'] },
    { en: 'pittu', aliases: ['pittu', 'puttu', 'புட்டு'] },
    { en: 'hoppers', aliases: ['hoppers', 'appa', 'appam'] },
    { en: 'samosa', aliases: ['samosa', 'samosas', 'samoosa'] },
    { en: 'patties', aliases: ['patty', 'patties', 'pattis'] },
    { en: 'rolls', aliases: ['roll', 'rolls', 'fish roll', 'egg roll'] },
    { en: 'doughnut', aliases: ['doughnut', 'donut', 'donuts', 'doughnuts'] },
    { en: 'croissant', aliases: ['croissant', 'croissants', 'croisant'] },
    { en: 'muffin', aliases: ['muffin', 'muffins', 'cupcake', 'cupcakes'] },
    { en: 'kavum', aliases: ['kavum', 'kewum', 'kawum', 'කැවුම්'] },
    { en: 'kokis', aliases: ['kokis', 'kokkis', 'කොකිස්'] },
    { en: 'aluwa', aliases: ['aluwa', 'aluva'] },
  ],

  /* ------------------------------------------------------------------ vegetables and greens */
  vegetables: [
    { en: 'vegetables', aliases: ['elavalu', 'elawalu', 'kaikari', 'vegetable', 'vegetables', 'veg', 'veggies', 'එළවළු', 'காய்கறி'] }, // NATIVE REVIEW: Sinhala spelling of elawalu
    { en: 'potato', aliases: ['ala', 'urulai', 'urulaikilangu', 'potato', 'potatoes', 'aloo', 'අල', 'உருளைக்கிழங்கு'] },
    { en: 'sweet potato', aliases: ['bathala', 'valli kilangu', 'sweet potato', 'sweet potatoes', 'බතල', 'வள்ளிக்கிழங்கு'] },
    { en: 'manioc', aliases: ['manioc', 'mannioca', 'maioca', 'cassava', 'maravalli', 'maravalli kilangu', 'මඤ්ඤොක්කා', 'மரவள்ளி'] },
    { en: 'onion', aliases: ['loku lunu', 'rathu lunu', 'bombay', 'bombay onion', 'big onion', 'red onion', 'vengayam', 'sinna vengayam', 'onion', 'onions', 'ලොකු ලූණු', 'රතු ලූණු', 'ලූණු', 'வெங்காயம்', 'சின்ன வெங்காயம்'] }, // NATIVE REVIEW: ලූණු (long u, onion) vs ලුණු (short u, salt) are often typed the same
    { en: 'garlic', aliases: ['sudu lunu', 'sudulunu', 'poondu', 'garlic', 'සුදු ලූණු', 'සුදුලූණු', 'பூண்டு'] },
    { en: 'spring onion', aliases: ['spring onion', 'spring onions', 'green onion', 'leeks', 'leek'] },
    { en: 'tomato', aliases: ['thakkali', 'takkali', 'tomato', 'tomatoes', 'tomatto', 'තක්කාලි', 'தக்காளி'] },
    { en: 'brinjal', aliases: ['wambatu', 'vambatu', 'katharikai', 'kathirikai', 'brinjal', 'eggplant', 'aubergine', 'වම්බටු', 'கத்தரிக்காய்'] },
    { en: 'okra', aliases: ['bandakka', 'vendakkai', 'okra', 'ladies fingers', 'lady finger', 'ochra', 'බණ්ඩක්කා', 'வெண்டைக்காய்'] },
    { en: 'pumpkin', aliases: ['wattakka', 'watakka', 'poosanikai', 'pumpkin', 'වට්ටක්කා', 'பூசணிக்காய்'] },
    { en: 'beans', aliases: ['bonchi', 'beans', 'green beans', 'french beans', 'බෝංචි', 'பீன்ஸ்'] },
    { en: 'cabbage', aliases: ['gova', 'muttaikose', 'cabbage', 'cabage', 'ගෝවා', 'முட்டைக்கோஸ்'] },
    { en: 'cauliflower', aliases: ['cauliflower', 'califlower', 'flower gova', 'காலிஃபிளவர்'] },
    { en: 'broccoli', aliases: ['broccoli', 'brocoli', 'brocolli'] },
    { en: 'snake gourd', aliases: ['pathola', 'patola', 'pudalangai', 'snake gourd', 'පතෝල', 'புடலங்காய்'] },
    { en: 'bitter gourd', aliases: ['karawila', 'karavila', 'pavakkai', 'bitter gourd', 'bittergourd', 'කරවිල', 'பாகற்காய்'] },
    { en: 'ash plantain', aliases: ['alu kesel', 'alukesel', 'vazhaikkai', 'raw banana', 'ash plantain', 'plantain', 'අලු කෙසෙල්', 'வாழைக்காய்'] },
    { en: 'drumstick', aliases: ['murunga', 'murungakkai', 'drumstick', 'drumsticks', 'මුරුංගා', 'முருங்கைக்காய்'] },
    { en: 'cucumber', aliases: ['pipinna', 'vellarikkai', 'cucumber', 'cucumbar', 'පිපිඤ්ඤා', 'வெள்ளரிக்காய்'] },
    { en: 'carrot', aliases: ['carrot', 'carrots', 'karat', 'carot', 'කැරට්', 'கேரட்'] }, // NATIVE REVIEW: loanword spelling in script
    { en: 'beetroot', aliases: ['beetroot', 'beet root', 'beets', 'bitroot', 'බීට්රූට්', 'பீட்ரூட்'] }, // NATIVE REVIEW: loanword spelling in script
    { en: 'capsicum', aliases: ['capsicum', 'capsicums', 'malu miris', 'bell pepper', 'green pepper', 'kudai milagai', 'මාළු මිරිස්', 'குடைமிளகாய்'] },
    { en: 'radish', aliases: ['radish', 'raabu', 'rabu', 'mooli', 'රාබු', 'முள்ளங்கி'] },
    { en: 'lettuce', aliases: ['lettuce', 'lettus', 'salad leaves'] },
    { en: 'celery', aliases: ['celery', 'selery'] },
    { en: 'mushroom', aliases: ['mushroom', 'mushrooms', 'mushrum'] },
    { en: 'sweet corn', aliases: ['sweet corn', 'sweetcorn', 'corn', 'iringu', 'cholam', 'ඉරිඟු', 'சோளம்'] },
    { en: 'green peas', aliases: ['green peas', 'peas', 'pattani', 'பட்டாணி'] },
    { en: 'kankun', aliases: ['kankun', 'kangkung', 'kangkong', 'water spinach', 'කංකුං'] },
    { en: 'gotukola', aliases: ['gotukola', 'gotu kola', 'ගොටුකොළ'] },
    { en: 'mukunuwenna', aliases: ['mukunuwenna', 'mukunuwana', 'mukunuvenna', 'මුකුණුවැන්න'] },
    { en: 'spinach', aliases: ['spinach', 'spinech', 'palak'] },
    { en: 'leafy greens', aliases: ['kola', 'keera', 'keerai', 'greens', 'leafy greens', 'leafy vegetables', 'කොළ', 'கீரை'], also: ['gotukola', 'mukunuwenna', 'kankun', 'spinach', 'lettuce'] }, // NATIVE REVIEW: bare කොළ means any leaf
    { en: 'ginger', aliases: ['inguru', 'inji', 'ginger', 'gingar', 'ඉඟුරු', 'இஞ்சி'] },
    { en: 'green chilli', aliases: ['amu miris', 'amumiris', 'pachai milagai', 'green chilli', 'green chili', 'green chillies', 'අමු මිරිස්', 'பச்சை மிளகாய்'] },
  ],

  /* ------------------------------------------------------------------ fruit */
  fruit: [
    { en: 'fruits', aliases: ['palathuru', 'palaturu', 'fruit', 'fruits', 'pazham', 'පලතුරු', 'பழங்கள்'] }, // NATIVE REVIEW: Sinhala spelling of palathuru
    { en: 'banana', aliases: ['kesel', 'kehel', 'vazhaipazham', 'banana', 'bananas', 'කෙසෙල්', 'வாழைப்பழம்'] },
    { en: 'mango', aliases: ['amba', 'mangai', 'maambazham', 'mango', 'mangoes', 'mangos', 'අඹ', 'மாம்பழம்'] },
    { en: 'papaya', aliases: ['papol', 'pappali', 'papaya', 'pawpaw', 'පැපොල්', 'பப்பாளி'] },
    { en: 'pineapple', aliases: ['annasi', 'anasi', 'pineapple', 'pine apple', 'අන්නාසි', 'அன்னாசி'] },
    { en: 'orange', aliases: ['dodam', 'thodampazham', 'orange', 'oranges', 'දොඩම්', 'தோடம்பழம்', 'ஆரஞ்சு'] },
    { en: 'apple', aliases: ['apple', 'apples', 'epal', 'ඇපල්', 'ஆப்பிள்'] },
    { en: 'grapes', aliases: ['midi', 'thiratchai', 'grapes', 'grape', 'draksha', 'මිදි', 'திராட்சை'] },
    { en: 'watermelon', aliases: ['komadu', 'tharpusani', 'watermelon', 'water melon', 'කොමඩු', 'தர்பூசணி'] },
    { en: 'avocado', aliases: ['avocado', 'avacado', 'aligatapera', 'alligator pear', 'අලිගැටපේර'] },
    { en: 'guava', aliases: ['pera', 'koyya', 'guava', 'guavas', 'පේර', 'கொய்யா'] },
    { en: 'pomegranate', aliases: ['delum', 'madulai', 'pomegranate', 'pomegranates', 'දෙළුම්', 'மாதுளை'] },
    { en: 'jackfruit', aliases: ['kos', 'polos', 'palakkai', 'jackfruit', 'jak', 'කොස්', 'පොළොස්', 'பலாப்பழம்'] }, // NATIVE REVIEW: පොළොස් (young jak) spelling
    { en: 'breadfruit', aliases: ['del', 'breadfruit', 'bread fruit', 'දෙල්'] },
    { en: 'rambutan', aliases: ['rambutan', 'rambuttan', 'rambutans', 'රඹුටන්'] },
    { en: 'mangosteen', aliases: ['mangosteen', 'mangustin', 'mangus', 'මැංගුස්'] },
    { en: 'durian', aliases: ['durian', 'duriyan', 'දුරියන්'] },
    { en: 'lime', aliases: ['dehi', 'elumichai', 'lime', 'limes', 'lemon', 'lemons', 'දෙහි', 'எலுமிச்சை'] },
    { en: 'strawberry', aliases: ['strawberry', 'strawberries', 'strawbery'] },
    { en: 'pear', aliases: ['pear', 'pears'] },
    { en: 'dates', aliases: ['dates', 'date', 'kurma', 'perichampazham'] },
    { en: 'kiwi', aliases: ['kiwi', 'kiwifruit'] },
    { en: 'melon', aliases: ['melon', 'musk melon', 'honeydew'] },
    { en: 'passion fruit', aliases: ['passion fruit', 'passionfruit'] },
    { en: 'dragon fruit', aliases: ['dragon fruit', 'dragonfruit'] },
    { en: 'wood apple', aliases: ['divul', 'wood apple', 'woodapple', 'දිවුල්'] },
    { en: 'king coconut', aliases: ['thambili', 'king coconut', 'kingcoconut', 'sevvalaneer', 'තඹිලි', 'செவ்விளநீர்'] },
    { en: 'coconut', aliases: ['pol', 'thenga', 'thengai', 'thenkai', 'coconut', 'coconuts', 'coconat', 'පොල්', 'தேங்காய்'] },
    { en: 'desiccated coconut', aliases: ['desiccated coconut', 'dried coconut', 'coconut powder', 'coconut flakes'] },
  ],

  /* ------------------------------------------------------------------ meat, fish, egg */
  meatFishEgg: [
    { en: 'egg', aliases: ['biththara', 'bittara', 'bithara', 'muttai', 'muddai', 'egg', 'eggs', 'බිත්තර', 'முட்டை'] },
    { en: 'chicken', aliases: ['kukul mas', 'kukulmas', 'kukul', 'kozhi', 'kozhi erachi', 'kozhi irachi', 'chicken', 'chiken', 'chickin', 'කුකුල් මස්', 'කුකුළු මස්', 'கோழி', 'கோழி இறைச்சி'] }, // NATIVE REVIEW: Sinhala කුකුළු මස් variant
    { en: 'meat', aliases: ['mas', 'erachi', 'irachi', 'meat', 'meats', 'මස්', 'இறைச்சி'] },
    { en: 'beef', aliases: ['harak mas', 'harakmas', 'maattu erachi', 'beef', 'හරක් මස්', 'மாட்டிறைச்சி'] },
    { en: 'pork', aliases: ['ura mas', 'uramas', 'pork', 'ඌරු මස්'] },
    { en: 'mutton', aliases: ['elu mas', 'elumas', 'mutton', 'goat meat', 'aattu erachi', 'එළු මස්', 'ஆட்டிறைச்சி'] },
    { en: 'fish', aliases: ['malu', 'maalu', 'meen', 'fish', 'fishes', 'මාළු', 'මාලු', 'மீன்'] },
    { en: 'dried fish', aliases: ['karawala', 'karavala', 'karuvadu', 'dried fish', 'dry fish', 'කරවල', 'கருவாடு'] },
    { en: 'sprats', aliases: ['sprats', 'sprat', 'halmessa', 'halmasso', 'haalmessa'] },
    { en: 'tuna', aliases: ['tuna', 'tunna', 'kelawalla', 'kelavalla', 'balaya', 'බලයා'] },
    { en: 'seer fish', aliases: ['thora', 'seer fish', 'seerfish', 'තෝරා'] },
    { en: 'prawns', aliases: ['issa', 'isso', 'issan', 'prawns', 'prawn', 'shrimp', 'shrimps', 'iraal', 'eraal', 'ඉස්සා', 'ඉස්සන්', 'இறால்'] },
    { en: 'crab', aliases: ['kakuluwo', 'kakuluwa', 'crab', 'crabs', 'nandu', 'කකුළුවා', 'நண்டு'] },
    { en: 'cuttlefish', aliases: ['cuttlefish', 'cuttle fish', 'squid', 'calamari'] },
    { en: 'sardine', aliases: ['sardine', 'sardines', 'sardin'] },
    { en: 'salmon', aliases: ['salmon', 'salmons'] },
    { en: 'mackerel', aliases: ['mackerel', 'mackeral'] },
    { en: 'canned fish', aliases: ['canned fish', 'tin fish', 'tinned fish', 'tin malu'] },
    { en: 'maldive fish', aliases: ['umbalakada', 'maldive fish', 'maldives fish', 'උම්බලකඩ'] },
    { en: 'sausages', aliases: ['sausage', 'sausages', 'sosej', 'sosage'] },
    { en: 'bacon', aliases: ['bacon', 'beacon'] },
    { en: 'ham', aliases: ['ham', 'hams'] },
    { en: 'nuggets', aliases: ['nugget', 'nuggets'] },
    { en: 'meatballs', aliases: ['meatball', 'meatballs', 'meat balls'] },
    { en: 'cutlets', aliases: ['cutlet', 'cutlets', 'cutles'] },
    { en: 'mince', aliases: ['mince', 'minced meat', 'minced beef', 'minced chicken'] },
    { en: 'liver', aliases: ['liver', 'livers'] },
    { en: 'whole chicken', aliases: ['whole chicken', 'full chicken'] },
    { en: 'chicken breast', aliases: ['chicken breast', 'breast meat', 'boneless chicken'] },
    { en: 'chicken legs', aliases: ['chicken legs', 'chicken leg', 'drumsticks chicken', 'chicken drumstick'] },
  ],

  /* ------------------------------------------------------------------ spices, condiments */
  spices: [
    { en: 'chilli', aliases: ['miris', 'milagai', 'chilli', 'chili', 'chillies', 'chilies', 'chillie', 'dried chilli', 'මිරිස්', 'மிளகாய்'] },
    { en: 'chilli powder', aliases: ['miris kudu', 'mirish kudu', 'milagai thool', 'milagai thul', 'chilli powder', 'chili powder', 'මිරිස් කුඩු', 'மிளகாய்த் தூள்', 'மிளகாய் தூள்'] },
    { en: 'chilli flakes', aliases: ['chilli flakes', 'chili flakes', 'crushed chilli', 'miris pitti'] },
    { en: 'pepper', aliases: ['gammiris', 'gam miris', 'milagu', 'pepper', 'black pepper', 'ගම්මිරිස්', 'மிளகு'] },
    { en: 'turmeric', aliases: ['kaha', 'manjal', 'turmeric', 'tumeric', 'turmeric powder', 'කහ', 'மஞ்சள்'] },
    { en: 'cinnamon', aliases: ['kurundu', 'pattai', 'cinnamon', 'cinamon', 'cinnamom', 'කුරුඳු', 'பட்டை'] },
    { en: 'cardamom', aliases: ['enasal', 'elakkai', 'cardamom', 'cardamon', 'cardomom', 'එනසාල්', 'ஏலக்காய்'] },
    { en: 'cloves', aliases: ['karabu nati', 'karabunati', 'kirambu', 'cloves', 'clove', 'කරාබු නැටි', 'கிராம்பு'] },
    { en: 'nutmeg', aliases: ['sadikka', 'jathikkai', 'nutmeg', 'nut meg', 'සාදික්කා', 'ஜாதிக்காய்'] },
    { en: 'cumin', aliases: ['suduru', 'seeragam', 'cumin', 'jeera', 'jeeragam', 'සූදුරු', 'சீரகம்'] },
    { en: 'fennel', aliases: ['maduru', 'sombu', 'fennel', 'sauf', 'මදුරු', 'சோம்பு'] },
    { en: 'mustard', aliases: ['aba', 'kadugu', 'mustard', 'mustard seeds', 'අබ', 'கடுகு'] },
    { en: 'fenugreek', aliases: ['uluhal', 'venthayam', 'fenugreek', 'methi', 'උළුහාල්', 'வெந்தயம்'] },
    { en: 'curry leaves', aliases: ['karapincha', 'kariveppilai', 'curry leaves', 'curry leaf', 'කරපිංචා', 'கறிவேப்பிலை'] },
    { en: 'pandan', aliases: ['rampe', 'rambai', 'pandan', 'pandan leaves', 'රම්පෑ'] }, // NATIVE REVIEW: Sinhala spelling of rampe
    { en: 'lemongrass', aliases: ['sera', 'serai', 'lemongrass', 'lemon grass'] },
    { en: 'coriander', aliases: ['kottamalli', 'kothamalli', 'kothamali', 'malli', 'coriander', 'corriander', 'dhania', 'කොත්තමල්ලි', 'கொத்தமல்லி', 'மல்லி'] },
    { en: 'curry powder', aliases: ['thuna paha', 'thunapaha', 'curry powder', 'kari powder', 'roasted curry powder', 'තුනපහ'] },
    { en: 'goraka', aliases: ['goraka', 'gamboge', 'ගොරකා'] },
    { en: 'garam masala', aliases: ['garam masala', 'garammasala', 'masala', 'masala powder'] },
    { en: 'sambar powder', aliases: ['sambar powder', 'sambar masala', 'sambhar powder'] },
    { en: 'biryani masala', aliases: ['biryani masala', 'briyani masala', 'biriyani masala'] },
    { en: 'saffron', aliases: ['saffron', 'kesar', 'kumkumapoo'] },
    { en: 'bay leaf', aliases: ['bay leaf', 'bay leaves'] },
    { en: 'sesame', aliases: ['sesame', 'sesame seeds', 'thala', 'ellu', 'තල', 'எள்'] },
    { en: 'vinegar', aliases: ['vinegar', 'vinagar', 'viniger', 'viniga'] },
    { en: 'soy sauce', aliases: ['soy sauce', 'soya sauce', 'soysauce'] },
    { en: 'tomato sauce', aliases: ['tomato sauce', 'ketchup', 'catsup', 'ketchap', 'tomato ketchup'] },
    { en: 'chilli sauce', aliases: ['chilli sauce', 'chili sauce', 'hot sauce'] },
    { en: 'mayonnaise', aliases: ['mayonnaise', 'mayo', 'mayonaise', 'mayonese'] },
    { en: 'pickle', aliases: ['pickle', 'pickles', 'achcharu', 'acharu', 'oorukai', 'urukai', 'අච්චාරු', 'ஊறுகாய்'] },
    { en: 'sambol', aliases: ['sambol', 'sambal', 'pol sambol', 'lunu miris', 'සම්බෝල'] },
    { en: 'ajinomoto', aliases: ['ajinomoto', 'msg', 'ajinomotto'] },
    { en: 'curry paste', aliases: ['curry paste', 'masala paste', 'ginger garlic paste'] },
    { en: 'mixed spices', aliases: ['spices', 'spice', 'mixed spices'] },
  ],

  /* ------------------------------------------------------------------ oils */
  oils: [
    { en: 'oil', aliases: ['thel', 'thail', 'ennai', 'oil', 'oils', 'cooking oil', 'තෙල්', 'எண்ணெய்'] },
    { en: 'coconut oil', aliases: ['pol thel', 'polthel', 'thengai ennai', 'coconut oil', 'coconut oils', 'පොල් තෙල්', 'தேங்காய் எண்ணெய்'] },
    { en: 'vegetable oil', aliases: ['vegetable oil', 'veg oil', 'palm oil', 'refined oil'] },
    { en: 'sunflower oil', aliases: ['sunflower oil', 'sunflour oil'] },
    { en: 'olive oil', aliases: ['olive oil', 'olive', 'olives'] },
    { en: 'sesame oil', aliases: ['thala thel', 'nallennai', 'sesame oil', 'gingelly oil', 'gingerly oil', 'තල තෙල්', 'நல்லெண்ணெய்'] },
    { en: 'mustard oil', aliases: ['mustard oil', 'kadugu ennai'] },
    { en: 'hair oil', aliases: ['hair oil', 'hair oils'] },
    { en: 'baby oil', aliases: ['baby oil', 'johnson oil'] },
    { en: 'lamp oil', aliases: ['lamp oil', 'kerosene', 'kerosine'] },
  ],

  /* ------------------------------------------------------------------ drinks */
  drinks: [
    { en: 'tea', aliases: ['the', 'theh', 'teh', 'tee', 'tea', 'chai', 'තේ', 'தேநீர்', 'டீ'] },
    { en: 'tea leaves', aliases: ['tea leaves', 'tea dust', 'dust tea', 'theyilai', 'thayilai', 'தேயிலை'] },
    { en: 'green tea', aliases: ['green tea', 'greentea'] },
    { en: 'coffee', aliases: ['kopi', 'kaapi', 'coffee', 'coffe', 'kofi', 'කෝපි', 'கோப்பி', 'காபி'] },
    { en: 'water', aliases: ['wathura', 'watura', 'thanni', 'thanneer', 'water', 'mineral water', 'drinking water', 'වතුර', 'தண்ணீர்'] },
    { en: 'soda', aliases: ['soda', 'soda water', 'sparkling water'] },
    { en: 'soft drink', aliases: ['soft drink', 'soft drinks', 'cool drink', 'cool drinks', 'fizzy drink', 'cola', 'gas drink'] },
    { en: 'juice', aliases: ['juice', 'juices', 'jus', 'jooce', 'fruit juice'] },
    { en: 'cordial', aliases: ['cordial', 'squash', 'syrup drink'] },
    { en: 'ginger beer', aliases: ['ginger beer', 'gingerbeer', 'ginger ale'] },
    { en: 'energy drink', aliases: ['energy drink', 'energy drinks'] },
    { en: 'faluda', aliases: ['faluda', 'falooda', 'faluda mix'] },
    { en: 'malted drink', aliases: ['malted drink', 'malt drink', 'malted milk'] },
    { en: 'herbal tea', aliases: ['herbal tea', 'herbal drink', 'herbal'] },
  ],

  /* ------------------------------------------------------------------ snacks and sweets */
  snacks: [
    { en: 'chips', aliases: ['chips', 'chip', 'crisps', 'crisp', 'potato chips'] },
    { en: 'chocolate', aliases: ['chocolate', 'chocolates', 'choclate', 'chocolat', 'sokalat', 'චොකලට්', 'சாக்லேட்'] }, // NATIVE REVIEW: loanword spelling in script
    { en: 'toffee', aliases: ['toffee', 'toffy', 'toffees', 'candy', 'candies', 'sweets'] },
    { en: 'jam', aliases: ['jam', 'jem', 'jams', 'fruit jam'] },
    { en: 'peanut butter', aliases: ['peanut butter', 'peanutbutter', 'pb'] },
    { en: 'ice cream', aliases: ['ice cream', 'icecream', 'ice creams', 'ais cream', 'අයිස්ක්‍රීම්'] }, // NATIVE REVIEW: Sinhala spelling of ice cream
    { en: 'jelly', aliases: ['jelly', 'jello', 'jellies'] },
    { en: 'pudding', aliases: ['pudding', 'puddin', 'puddings'] },
    { en: 'popcorn', aliases: ['popcorn', 'pop corn'] },
    { en: 'murukku', aliases: ['murukku', 'muruku', 'murukkoo', 'முறுக்கு'] },
    { en: 'vadai', aliases: ['vadai', 'wadai', 'vada', 'wade', 'வடை'] },
    { en: 'papadam', aliases: ['papadam', 'papadum', 'pappadam', 'papad', 'appalam', 'அப்பளம்'] },
    { en: 'mixture', aliases: ['mixture', 'bombay mix', 'spicy mix'] },
    { en: 'nuts', aliases: ['nuts', 'mixed nuts', 'nut'] },
    { en: 'raisins', aliases: ['raisins', 'raisin', 'kismis', 'sultanas'] },
    { en: 'wafers', aliases: ['wafer', 'wafers', 'wafar'] },
    { en: 'cereal bar', aliases: ['cereal bar', 'granola', 'muesli', 'granola bar'] },
    { en: 'banana chips', aliases: ['banana chips', 'kesel chips', 'kehel chips'] },
    { en: 'manioc chips', aliases: ['manioc chips', 'cassava chips', 'maioca chips'] },
    { en: 'chewing gum', aliases: ['chewing gum', 'gum', 'bubble gum'] },
    { en: 'dried fruit', aliases: ['dried fruit', 'dried fruits', 'dry fruits'] },
  ],

  /* ------------------------------------------------------------------ baby */
  baby: [
    { en: 'diapers', aliases: ['diaper', 'diapers', 'pampers', 'nappy', 'nappies', 'dayper', 'pull ups', 'baby pants'] },
    { en: 'baby wipes', aliases: ['baby wipes', 'wet wipes', 'wet tissue', 'wipes'] },
    { en: 'baby food', aliases: ['baby food', 'cerelac', 'baby cereal', 'infant cereal'] },
    { en: 'baby milk', aliases: ['baby milk', 'infant formula', 'formula milk', 'lactogen', 'baby formula'] },
    { en: 'baby powder', aliases: ['baby powder', 'talcum', 'talc', 'talcum powder'] },
    { en: 'baby soap', aliases: ['baby soap', 'baby bath'] },
    { en: 'baby shampoo', aliases: ['baby shampoo'] },
    { en: 'baby lotion', aliases: ['baby lotion', 'baby cream'] },
    { en: 'feeding bottle', aliases: ['feeding bottle', 'baby bottle', 'milk bottle', 'nipple'] },
    { en: 'pacifier', aliases: ['pacifier', 'soother', 'dummy', 'teether'] },
    { en: 'diaper rash cream', aliases: ['diaper rash cream', 'nappy rash cream', 'rash cream'] },
    { en: 'baby', aliases: ['baby', 'babies', 'infant', 'newborn', 'new born'] },
  ],

  /* ------------------------------------------------------------------ household */
  household: [
    { en: 'detergent', aliases: ['detergent', 'washing powder', 'laundry powder', 'surf', 'washing liquid', 'laundry detergent'] },
    { en: 'dishwash', aliases: ['dishwash', 'dish wash', 'dishwashing', 'dish soap', 'dishwashing liquid', 'vim'] },
    { en: 'bleach', aliases: ['bleach', 'thick bleach', 'toilet cleaner'] },
    { en: 'floor cleaner', aliases: ['floor cleaner', 'floor wash', 'floor cleaning'] },
    { en: 'glass cleaner', aliases: ['glass cleaner', 'window cleaner'] },
    { en: 'toilet paper', aliases: ['toilet paper', 'toilet roll', 'tissue roll', 'toilet tissue'] },
    { en: 'tissue', aliases: ['tissue', 'tissues', 'paper napkin', 'paper napkins', 'serviette'] },
    { en: 'garbage bags', aliases: ['garbage bag', 'garbage bags', 'trash bags', 'bin bags', 'bin liner', 'dustbin bags'] },
    { en: 'matches', aliases: ['matches', 'match box', 'matchbox', 'machis'] },
    { en: 'candles', aliases: ['candle', 'candles', 'candel'] },
    { en: 'mosquito coil', aliases: ['mosquito coil', 'mosquito coils', 'mosquito repellent'] },
    { en: 'insecticide', aliases: ['insecticide', 'bug spray', 'insect spray', 'ant powder', 'cockroach spray'] },
    { en: 'battery', aliases: ['battery', 'batteries', 'cells', 'aa battery', 'aaa battery'] },
    { en: 'bulb', aliases: ['bulb', 'bulbs', 'led bulb', 'light bulb'] },
    { en: 'foil', aliases: ['foil', 'aluminium foil', 'aluminum foil', 'cling film', 'cling wrap'] },
    { en: 'scrubber', aliases: ['scrubber', 'sponge', 'scouring pad', 'cleaning cloth', 'scrub'] },
    { en: 'broom', aliases: ['broom', 'sweeping brush', 'mop'] },
    { en: 'gas', aliases: ['gas', 'lp gas', 'gas cylinder'] },
    { en: 'polythene', aliases: ['polythene', 'shopping bag', 'carrier bag', 'poly bag', 'polybag', 'plastic bag'] },
    { en: 'air freshener', aliases: ['air freshener', 'room freshener', 'freshener'] },
    { en: 'fabric softener', aliases: ['fabric softener', 'softener', 'fabric conditioner'] },
    { en: 'phenyl', aliases: ['phenyl', 'phenol', 'disinfectant'] },
    { en: 'camphor', aliases: ['camphor', 'kapuru', 'karpooram', 'කපුරු', 'கற்பூரம்'] },
    { en: 'incense', aliases: ['incense', 'agarbatti', 'agarbathi', 'incense sticks', 'dhoop'] },
    { en: 'lighter', aliases: ['lighter', 'lighters'] },
    { en: 'dog food', aliases: ['dog food', 'puppy food'] },
    { en: 'cat food', aliases: ['cat food', 'kitten food'] },
    { en: 'pet food', aliases: ['pet food', 'pets food'] },
  ],

  /* ------------------------------------------------------------------ personal care */
  personalCare: [
    { en: 'soap', aliases: ['soap', 'soaps', 'saban', 'saboon', 'sabun', 'bar soap', 'bathing soap', 'සබන්', 'சவர்க்காரம்', 'சோப்பு'] },
    { en: 'shampoo', aliases: ['shampoo', 'shampu', 'shampoos', 'ෂැම්පු', 'ஷாம்பு'] }, // NATIVE REVIEW: loanword spelling in script
    { en: 'conditioner', aliases: ['conditioner', 'hair conditioner', 'conditionar'] },
    { en: 'toothpaste', aliases: ['toothpaste', 'tooth paste', 'tootpaste', 'dental paste', 'பற்பசை'] },
    { en: 'toothbrush', aliases: ['toothbrush', 'tooth brush', 'tothbrush'] },
    { en: 'mouthwash', aliases: ['mouthwash', 'mouth wash', 'mouth rinse'] },
    { en: 'face wash', aliases: ['face wash', 'facewash', 'face cleanser', 'cleanser'] },
    { en: 'face cream', aliases: ['face cream', 'fairness cream', 'day cream', 'night cream'] },
    { en: 'body lotion', aliases: ['lotion', 'body lotion', 'moisturiser', 'moisturizer', 'vaseline', 'petroleum jelly'] },
    { en: 'sunscreen', aliases: ['sunscreen', 'sun screen', 'sunblock', 'sun block'] },
    { en: 'deodorant', aliases: ['deodorant', 'deo', 'roll on', 'body spray', 'deodarant'] },
    { en: 'perfume', aliases: ['perfume', 'perfumes', 'cologne', 'body mist', 'fragrance'] },
    { en: 'razor', aliases: ['razor', 'razors', 'shaving', 'shaving cream', 'shaving foam', 'blade'] },
    { en: 'sanitary pads', aliases: ['sanitary pads', 'sanitary pad', 'sanitary napkins', 'sanitary towel', 'kotex', 'whisper'] },
    { en: 'cotton buds', aliases: ['cotton buds', 'ear buds', 'earbuds', 'cotton wool', 'cotton balls'] },
    { en: 'hair dye', aliases: ['hair dye', 'hair color', 'hair colour', 'henna', 'mehendi', 'mehandi'] },
    { en: 'hand wash', aliases: ['hand wash', 'handwash', 'hand sanitizer', 'sanitizer', 'sanitiser', 'hand sanitiser'] },
    { en: 'face mask', aliases: ['face mask', 'face masks', 'surgical mask', 'mask'] },
    { en: 'lip balm', aliases: ['lip balm', 'lip care', 'chapstick', 'lipbalm'] },
    { en: 'comb', aliases: ['comb', 'combs', 'hair brush', 'hairbrush'] },
    { en: 'nail cutter', aliases: ['nail cutter', 'nail clipper', 'nail clippers'] },
    { en: 'hair gel', aliases: ['hair gel', 'hair cream', 'hair wax'] },
  ],
};

export const DICTIONARY_THEMES = Object.keys(DICTIONARY_GROUPS) as DictTheme[];

/** Every entry, theme by theme. */
export const DICTIONARY: DictEntry[] = DICTIONARY_THEMES.flatMap((t) => DICTIONARY_GROUPS[t]);
