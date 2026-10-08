export type DefaultCrimeCategory =
  | 'হত্যা/খুন'
  | 'ডাকাতি ও ছিনতাই'
  | 'নারী ও শিশু নির্যাতন'
  | 'অপহরণ'
  | 'পুলিশের ওপর হামলা'
  | 'পার্বত্য জেলা'
  | 'অস্ত্র ও বিস্ফোরক'
  | 'মাদকদ্রব্য ও চোরাচালান'
  | 'চুরি'
  | 'অনলাইন স্কাম/জুয়া';

export type CrimeCategory = string;

export interface CategoryDefinition {
  id: string;
  name: CrimeCategory;
  englishLabel: string;
  description: string;
  defaultKeywords: string[];
  searchQueryTerms: string[];
  isCustom?: boolean;
}

export const CRIME_CATEGORIES: CategoryDefinition[] = [
  {
    id: 'homicide',
    name: 'হত্যা/খুন',
    englishLabel: 'Homicide & Murder',
    description: 'খুন, মরদেহ উদ্ধার, পিটিয়ে বা কুপিয়ে হত্যা এবং রহস্যজনক মৃত্যুর সংবাদ',
    defaultKeywords: [
      'হত্যা',
      'খুন',
      'মরদেহ উদ্ধার',
      'লাশ উদ্ধার',
      'পিটিয়ে হত্যা',
      'গুলি করে হত্যা',
      'ছুরিকাঘাতে হত্যা',
      'গলা কেটে হত্যা',
      'হত্যাকাণ্ড',
      'নিহত',
    ],
    searchQueryTerms: ['হত্যা', 'খুন', '"লাশ উদ্ধার"', '"মরদেহ উদ্ধার"', 'হত্যাকাণ্ড'],
  },
  {
    id: 'robbery',
    name: 'ডাকাতি ও ছিনতাই',
    englishLabel: 'Robbery & Snatching',
    description: 'ডাকাতি, ছিনতাই, অস্ত্রের মুখে জিম্মি, মহাসড়ক ও ব্যাংক ডাকাতির ঘটনা',
    defaultKeywords: [
      'ডাকাতি',
      'ছিনতাই',
      'ডাকাত',
      'ছিনতাইকারী',
      'গণডাকাতি',
      'অস্ত্রের মুখে জিম্মি',
      'মহাসড়কে ডাকাতি',
      'ডাকাত চক্র',
      'লুটপাট',
    ],
    searchQueryTerms: ['ডাকাতি', 'ছিনতাই', 'ছিনতাইকারী', '"ডাকাত আটক"'],
  },
  {
    id: 'women_children',
    name: 'নারী ও শিশু নির্যাতন',
    englishLabel: 'Violence Against Women & Children',
    description: 'ধর্ষণ, যৌন নিপীড়ন, যৌতুকের জন্য নির্যাতন, গৃহবধূ ও শিশু নির্যাতন সংক্রান্ত সংবাদ',
    defaultKeywords: [
      'নারী নির্যাতন',
      'শিশু নির্যাতন',
      'ধর্ষণ',
      'গণধর্ষণ',
      'যৌন নিপীড়ন',
      'যৌতুক',
      'ইভটিজিং',
      'গৃহবধূকে নির্যাতন',
      'শিশু বলাৎকার',
      'ধর্ষণচেষ্টা',
    ],
    searchQueryTerms: ['"নারী নির্যাতন"', '"শিশু নির্যাতন"', 'ধর্ষণ', 'গণধর্ষণ', '"যৌন নিপীড়ন"'],
  },
  {
    id: 'kidnapping',
    name: 'অপহরণ',
    englishLabel: 'Kidnapping & Abduction',
    description: 'অপহরণ, মুক্তিপণ দাবি, জিম্মি উদ্ধার ও অপহরণকারী চক্রের তৎপরতা',
    defaultKeywords: [
      'অপহরণ',
      'মুক্তিপণ',
      'জিম্মি উদ্ধার',
      'অপহৃত',
      'অপহরণকারী',
      'নিখোঁজ উদ্ধার',
      'গুম',
      'জিম্মি',
    ],
    searchQueryTerms: ['অপহরণ', 'মুক্তিপণ', 'অপহৃত', 'অপহরণকারী'],
  },
  {
    id: 'police_attack',
    name: 'পুলিশের ওপর হামলা',
    englishLabel: 'Attack on Police',
    description: 'পুলিশের ওপর হামলা, থানায় হামলা, আসামি ছিনতাই ও দায়িত্বরত পুলিশ সদস্য আহত',
    defaultKeywords: [
      'পুলিশের ওপর হামলা',
      'থানায় হামলা',
      'পুলিশ আহত',
      'পুলিশকে মারধর',
      'আসামি ছিনতাই',
      'টহল পুলিশে হামলা',
      'পুলিশের গাড়ি ভাঙচুর',
      'পুলিশের সঙ্গে সংঘর্ষ',
    ],
    searchQueryTerms: ['"পুলিশের ওপর হামলা"', '"পুলিশ আহত"', '"আসামি ছিনতাই"', '"পুলিশকে মারধর"'],
  },
  {
    id: 'hill_tracts',
    name: 'পার্বত্য জেলা',
    englishLabel: 'Chittagong Hill Tracts',
    description: 'রাঙামাটি, খাগড়াছড়ি ও বান্দরবান পার্বত্য জেলার নিরাপত্তা, সংঘর্ষ, অস্ত্র ও অভিযান',
    defaultKeywords: [
      'পার্বত্য জেলা',
      'রাঙামাটি',
      'খাগড়াছড়ি',
      'বান্দরবান',
      'কুকি-চিন',
      'কেএনএফ',
      'পাহাড়ি সন্ত্রাসী',
      'সাজেক',
      'রুমা',
      'থানচি',
      'জেএসএস',
      'ইউপিডিএফ',
    ],
    searchQueryTerms: ['রাঙামাটি', 'খাগড়াছড়ি', 'বান্দরবান', 'কেএনএফ', '"পার্বত্য জেলা"'],
  },
  {
    id: 'arms_explosives',
    name: 'অস্ত্র ও বিস্ফোরক',
    englishLabel: 'Arms & Explosives',
    description: 'অবৈধ আগ্নেয়াস্ত্র উদ্ধার, গোলাগুলি, ককটেল ও বিস্ফোরক দ্রব্য উদ্ধার অভিযান',
    defaultKeywords: [
      'অস্ত্র উদ্ধার',
      'বিস্ফোরক',
      'ককটেল বিস্ফোরণ',
      'গুলিবর্ষণ',
      'অবৈধ অস্ত্র',
      'পিস্তল উদ্ধার',
      'বোমা উদ্ধার',
      'গুলি ও ম্যাগাজিন',
      'আগ্নেয়াস্ত্র',
      'গোলাগুলি',
    ],
    searchQueryTerms: ['"অস্ত্র উদ্ধার"', 'বিস্ফোরক', '"ককটেল বিস্ফোরণ"', '"অবৈধ অস্ত্র"', '"পিস্তল উদ্ধার"'],
  },
  {
    id: 'narcotics_smuggling',
    name: 'মাদকদ্রব্য ও চোরাচালান',
    englishLabel: 'Narcotics & Smuggling',
    description: 'ইয়াবা, ফেনসিডিল, আইস, গাঁজা উদ্ধার, মাদক কারবারি আটক এবং সীমান্ত চোরাচালান',
    defaultKeywords: [
      'মাদকদ্রব্য',
      'চোরাচালান',
      'ইয়াবা উদ্ধার',
      'ইয়াবা',
      'ফেনসিডিল',
      'আইস উদ্ধার',
      'গাঁজা উদ্ধার',
      'মাদক কারবারি',
      'স্বর্ণ চোরাচালান',
      'হেরোইন',
    ],
    searchQueryTerms: ['মাদক', 'ইয়াবা', 'চোরাচালান', 'ফেনসিডিল', '"মাদক কারবারি"'],
  },
  {
    id: 'theft',
    name: 'চুরি',
    englishLabel: 'Theft & Burglary',
    description: 'বাসা-বাড়ি ও দোকানে চুরি, মোটরসাইকেল চুরি, গরু চুরি এবং চোর চক্র আটক',
    defaultKeywords: [
      'চুরি',
      'চুরির ঘটনা',
      'তালা ভেঙে চুরি',
      'মোটরসাইকেল চুরি',
      'গরু চুরি',
      'চোর চক্র',
      'চোরাই মাল উদ্ধার',
      'চোর আটক',
    ],
    searchQueryTerms: ['চুরি', '"চোর আটক"', '"মোটরসাইকেল চুরি"', '"চোর চক্র"'],
  },
  {
    id: 'online_scam_gambling',
    name: 'অনলাইন স্কাম/জুয়া',
    englishLabel: 'Online Scam & Gambling',
    description: 'অনলাইন জুয়া, বেটিং অ্যাপ, সাইবার প্রতারণা, মোবাইল ব্যাংকিং হ্যাকিং ও ক্রিপ্টো স্ক্যাম',
    defaultKeywords: [
      'অনলাইন জুয়া',
      'অনলাইন স্কাম',
      'সাইবার প্রতারণা',
      'বেটিং',
      'বিকাশ প্রতারণা',
      'হ্যাকিং',
      'ক্যাসিনো',
      'অনলাইন প্রতারক',
      'জুয়াড়ি আটক',
      'প্রতারক চক্র',
    ],
    searchQueryTerms: ['"অনলাইন জুয়া"', '"সাইবার প্রতারণা"', '"অনলাইন প্রতারণা"', 'জুয়াড়ি', '"প্রতারক চক্র"'],
  },
];

export const VALID_CATEGORIES: CrimeCategory[] = CRIME_CATEGORIES.map((c) => c.name);

export interface NewsPortalInfo {
  id: string;
  name: string;
  englishName: string;
  domain: string;
  rssUrl?: string;
}

export const BANGLADESH_NEWS_PORTALS: NewsPortalInfo[] = [
  { id: 'prothomalo', name: 'প্রথম আলো', englishName: 'Prothom Alo', domain: 'prothomalo.com', rssUrl: 'https://www.prothomalo.com/feed/' },
  { id: 'jugantor', name: 'যুগান্তর', englishName: 'Jugantor', domain: 'jugantor.com' },
  { id: 'kalerkantho', name: 'কালের কণ্ঠ', englishName: 'Kaler Kantho', domain: 'kalerkantho.com' },
  { id: 'samakal', name: 'সমকাল', englishName: 'Samakal', domain: 'samakal.com' },
  { id: 'ittefaq', name: 'ইত্তেফাক', englishName: 'The Daily Ittefaq', domain: 'ittefaq.com.bd' },
  { id: 'dhakapost', name: 'ঢাকা পোস্ট', englishName: 'Dhaka Post', domain: 'dhakapost.com', rssUrl: 'https://www.dhakapost.com/rss.xml' },
  { id: 'jagonews24', name: 'জাগো নিউজ ২৪', englishName: 'JagoNews24', domain: 'jagonews24.com', rssUrl: 'https://www.jagonews24.com/rss/rss.xml' },
  { id: 'banglatribune', name: 'বাংলা ট্রিবিউন', englishName: 'Bangla Tribune', domain: 'banglatribune.com' },
  { id: 'bdnews24', name: 'বিডিনিউজ২৪', englishName: 'bdnews24.com', domain: 'bangla.bdnews24.com', rssUrl: 'https://bangla.bdnews24.com/?widgetName=rssfeed&widgetId=1150&getXmlFeed=true' },
  { id: 'somoynews', name: 'সময় নিউজ', englishName: 'Somoy News', domain: 'somoynews.tv' },
  { id: 'jamunatv', name: 'যমুনা টিভি', englishName: 'Jamuna TV', domain: 'jamuna.tv' },
  { id: 'kalbela', name: 'কালবেলা', englishName: 'Kalbela', domain: 'kalbela.com' },
  { id: 'bonikbarta', name: 'বণিক বার্তা', englishName: 'Bonik Barta', domain: 'bonikbarta.net' },
  { id: 'thedailystar', name: 'দ্য ডেইলি স্টার বাংলা', englishName: 'The Daily Star Bangla', domain: 'bangla.thedailystar.net' },
  { id: 'mzamin', name: 'মানবজমিন', englishName: 'Manab Zamin', domain: 'mzamin.com' },
  { id: 'nayadiganta', name: 'নয়া দিগন্ত', englishName: 'Daily Naya Diganta', domain: 'dailynayadiganta.com' },
  { id: 'bdpratidin', name: 'বাংলাদেশ প্রতিদিন', englishName: 'Bangladesh Pratidin', domain: 'bd-pratidin.com' },
  { id: 'channeli', name: 'চ্যানেল আই', englishName: 'Channel i Online', domain: 'channelionline.com' },
  { id: 'deshrupantor', name: 'দেশ রূপান্তর', englishName: 'Desh Rupantor', domain: 'deshrupantor.com' },
  { id: 'ajkerpatrika', name: 'আজকের পত্রিকা', englishName: 'Ajker Patrika', domain: 'ajkerpatrika.com' },
  { id: 'dhakamail', name: 'ঢাকা মেইল', englishName: 'Dhaka Mail', domain: 'dhakamail.com' },
  { id: 'risingbd', name: 'রাইজিংবিডি', englishName: 'RisingBD', domain: 'risingbd.com', rssUrl: 'https://www.risingbd.com/rss/rss.xml' },
];

export const BANGLADESH_DISTRICTS: string[] = [
  'ঢাকা',
  'চট্টগ্রাম',
  'রাঙামাটি',
  'খাগড়াছড়ি',
  'বান্দরবান',
  'কক্সবাজার',
  'গাজীপুর',
  'নারায়ণগঞ্জ',
  'নরসিংদী',
  'মানিকগঞ্জ',
  'মুন্সীগঞ্জ',
  'টাঙ্গাইল',
  'কিশোরগঞ্জ',
  'ফরিদপুর',
  'গোপালগঞ্জ',
  'মাদারীপুর',
  'রাজবাড়ী',
  'শরীয়তপুর',
  'কুমিল্লা',
  'ফেনী',
  'ব্রাহ্মণবাড়িয়া',
  'নোয়াখালী',
  'লক্ষ্মীপুর',
  'চাঁদপুর',
  'সিলেট',
  'মৌলভীবাজার',
  'হবিগঞ্জ',
  'সুনামগঞ্জ',
  'রাজশাহী',
  'বগুড়া',
  'পাবনা',
  'সিরাজগঞ্জ',
  'নাটোর',
  'নওগাঁ',
  'চাঁপাইনবাবগঞ্জ',
  'জয়পুরহাট',
  'খুলনা',
  'যশোর',
  'সাতক্ষীরা',
  'বাগেরহাট',
  'কুষ্টিয়া',
  'ঝিনাইদহ',
  'চুয়াডাঙ্গা',
  'মেহেরপুর',
  'মাগুরা',
  'নড়াইল',
  'বরিশাল',
  'পটুয়াখালী',
  'ভোলা',
  'পিরোজপুর',
  'বরগুনা',
  'ঝালকাঠি',
  'রংপুর',
  'দিনাজপুর',
  'কুড়িগ্রাম',
  'গাইবান্ধা',
  'নীলফামারী',
  'লালমনিরহাট',
  'ঠাকুরগাঁও',
  'পঞ্চগড়',
  'ময়মনসিংহ',
  'জামালপুর',
  'শেরপুর',
  'নেত্রকোনা',
];
