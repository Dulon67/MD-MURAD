import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import * as cheerio from 'cheerio';
import {
  CRIME_CATEGORIES,
  BANGLADESH_NEWS_PORTALS,
  BANGLADESH_DISTRICTS,
  type CrimeCategory,
} from './src/constants/taxonomy.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ScrapedArticlePayload {
  id: string;
  title: string;
  summary: string;
  url: string;
  portalName: string;
  portalDomain: string;
  category: CrimeCategory;
  matchedKeywords: string;
  district: string;
  publishedDate: string;
  publishedAt: string;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

function createDeterministicId(url: string, title: string): string {
  const normalized = (title.trim() || url.trim()).toLowerCase();
  const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 28);
  return `art_${hash}`;
}

function stripHtml(rawHtml: string): string {
  if (!rawHtml) return '';
  try {
    const $ = cheerio.load(rawHtml);
    const text = $.text().replace(/\s+/g, ' ').trim();
    return text;
  } catch {
    return rawHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

function toBangladeshDateString(dateObj: Date): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const formatted = formatter.format(dateObj);
    if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) {
      return formatted;
    }
  } catch {
    // Fallback to UTC ISO slice
  }
  return dateObj.toISOString().slice(0, 10);
}

function detectPortal(
  rawSourceTitle: string,
  rawSourceUrl: string,
  articleTitle: string,
  linkUrl: string
): { portalName: string; portalDomain: string; cleanTitle: string } {
  let cleanTitle = articleTitle.trim();
  let sourceLabel = rawSourceTitle.trim();

  // Google News RSS titles often end with " - Portal Name"
  const lastDashIdx = cleanTitle.lastIndexOf(' - ');
  if (lastDashIdx > 10) {
    const trailingSource = cleanTitle.slice(lastDashIdx + 3).trim();
    const mainHeadline = cleanTitle.slice(0, lastDashIdx).trim();
    if (!sourceLabel && trailingSource.length <= 50) {
      sourceLabel = trailingSource;
    }
    if (mainHeadline.length >= 5) {
      cleanTitle = mainHeadline;
    }
  }

  const combinedCheck = `${sourceLabel} ${rawSourceUrl} ${linkUrl}`.toLowerCase();

  for (const portal of BANGLADESH_NEWS_PORTALS) {
    if (
      combinedCheck.includes(portal.domain.toLowerCase()) ||
      combinedCheck.includes(portal.name.toLowerCase()) ||
      combinedCheck.includes(portal.englishName.toLowerCase())
    ) {
      return {
        portalName: portal.name,
        portalDomain: portal.domain,
        cleanTitle,
      };
    }
  }

  // Extract domain from rawSourceUrl or linkUrl if available
  let extractedDomain = 'news.google.com';
  for (const candidateUrl of [rawSourceUrl, linkUrl]) {
    if (candidateUrl && candidateUrl.startsWith('http')) {
      try {
        const host = new URL(candidateUrl).hostname.replace(/^www\./, '');
        if (host && !host.includes('google.com')) {
          extractedDomain = host;
          break;
        }
      } catch {
        // Ignore invalid URL
      }
    }
  }

  return {
    portalName: (sourceLabel || 'বাংলাদেশ নিউজ পোর্টাল').slice(0, 110),
    portalDomain: extractedDomain.slice(0, 110),
    cleanTitle,
  };
}

function detectDistrict(text: string): string {
  for (const district of BANGLADESH_DISTRICTS) {
    if (text.includes(district)) {
      return district;
    }
  }
  if (text.includes('পার্বত্য') || text.includes('সাজেক') || text.includes('রুমা') || text.includes('থানচি')) {
    return 'পার্বত্য অঞ্চল';
  }
  if (text.includes('রাজধানী') || text.includes('মিরপুর') || text.includes('উত্তরা') || text.includes('যাত্রাবাড়ী') || text.includes('মোহাম্মদপুর') || text.includes('গুলশান') || text.includes('সাভার') || text.includes('কেরানীগঞ্জ')) {
    return 'ঢাকা';
  }
  return 'সারাদেশ';
}

function classifyAndMatchKeywords(
  text: string,
  preferredCategory: CrimeCategory | null,
  customCategoryKeywords: Record<string, string[]>,
  extraKeywords: string[]
): { category: CrimeCategory; matchedKeywords: string[] } | null {
  let bestCategory: CrimeCategory | null = preferredCategory;
  let bestMatches: string[] = [];

  // Build unified list of all known categories (built-in + custom from customCategoryKeywords)
  const allCategoryNames = Array.from(
    new Set([
      ...CRIME_CATEGORIES.map((c) => c.name),
      ...Object.keys(customCategoryKeywords),
    ])
  );

  for (const catName of allCategoryNames) {
    const builtInDef = CRIME_CATEGORIES.find((c) => c.name === catName);
    const customList = customCategoryKeywords[catName] || [];
    const combinedKeywords = Array.from(
      new Set([...(builtInDef ? builtInDef.defaultKeywords : [catName]), ...customList])
    );
    const hits = combinedKeywords.filter((kw) => kw && text.includes(kw));

    if (preferredCategory === catName && hits.length > 0) {
      bestCategory = catName;
      bestMatches = hits;
      break;
    }

    if (hits.length > bestMatches.length) {
      bestCategory = catName;
      bestMatches = hits;
    }
  }

  const extraHits = extraKeywords.filter((kw) => kw && text.includes(kw));
  const allMatches = Array.from(new Set([...bestMatches, ...extraHits]));

  if (!bestCategory && allMatches.length === 0) {
    return null;
  }

  const finalCategory: CrimeCategory = bestCategory || preferredCategory || 'হত্যা/খুন';
  const fallbackKeyword =
    customCategoryKeywords[finalCategory]?.[0] ||
    CRIME_CATEGORIES.find((c) => c.name === finalCategory)?.defaultKeywords[0] ||
    finalCategory;

  const finalKeywords =
    allMatches.length > 0 ? allMatches.slice(0, 8) : [fallbackKeyword];

  return {
    category: finalCategory,
    matchedKeywords: finalKeywords,
  };
}

async function fetchXmlFeed(url: string, timeoutMs = 8000): Promise<any[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
    });
    if (!response.ok) return [];
    const xmlText = await response.text();
    const parsed = xmlParser.parse(xmlText);
    const channelItems = parsed?.rss?.channel?.item || parsed?.feed?.entry || [];
    return Array.isArray(channelItems) ? channelItems : channelItems ? [channelItems] : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function runLiveScrape(options: {
  categories?: CrimeCategory[];
  portalDomain?: string;
  startDate?: string;
  endDate?: string;
  customKeywords?: string;
  categoryKeywordsMap?: Record<string, string[]>;
}): Promise<{
  articles: ScrapedArticlePayload[];
  feedsQueried: number;
  portalsMatched: string[];
  scrapedAt: string;
}> {
  const categoryKeywordsMap = options.categoryKeywordsMap || {};
  const allKnownCategories = Array.from(
    new Set([
      ...CRIME_CATEGORIES.map((c) => c.name),
      ...Object.keys(categoryKeywordsMap),
    ])
  );

  const targetCategories: CrimeCategory[] =
    options.categories && options.categories.length > 0
      ? options.categories
      : allKnownCategories;

  const extraKeywordList = (options.customKeywords || '')
    .split(/[,،\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);

  const portalDomainFilter =
    options.portalDomain && options.portalDomain !== 'all' ? options.portalDomain.trim() : '';

  const feedTasks: Array<{ url: string; categoryHint: CrimeCategory | null }> = [];

  for (const catName of targetCategories) {
    const catDef = CRIME_CATEGORIES.find((c) => c.name === catName);
    const customTerms = categoryKeywordsMap[catName] || [];

    const baseTerms =
      customTerms.length > 0
        ? customTerms.slice(0, 5).map((t) => (t.includes(' ') ? `"${t}"` : t))
        : catDef
        ? catDef.searchQueryTerms
        : [catName.includes(' ') ? `"${catName}"` : catName];

    const mergedTerms = Array.from(new Set([...baseTerms, ...extraKeywordList.slice(0, 3)]));
    let queryStr = `(${mergedTerms.join(' OR ')}) বাংলাদেশ`;

    if (portalDomainFilter) {
      queryStr += ` site:${portalDomainFilter}`;
    }
    if (options.startDate && /^\d{4}-\d{2}-\d{2}$/.test(options.startDate)) {
      queryStr += ` after:${options.startDate}`;
    }
    if (options.endDate && /^\d{4}-\d{2}-\d{2}$/.test(options.endDate)) {
      // Add 1 day to endDate for Google News `before:` so endDate itself is inclusive
      const endObj = new Date(`${options.endDate}T00:00:00Z`);
      if (!isNaN(endObj.getTime())) {
        endObj.setUTCDate(endObj.getUTCDate() + 1);
        const inclusiveBefore = endObj.toISOString().slice(0, 10);
        queryStr += ` before:${inclusiveBefore}`;
      }
    }

    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(
      queryStr
    )}&hl=bn&gl=BD&ceid=BD:bn`;
    feedTasks.push({ url: rssUrl, categoryHint: catName });
  }

  // If user also provided custom keywords explicitly, run a dedicated query for them
  if (extraKeywordList.length > 0) {
    let customQ = `(${extraKeywordList
      .slice(0, 5)
      .map((k) => (k.includes(' ') ? `"${k}"` : k))
      .join(' OR ')}) বাংলাদেশ`;
    if (portalDomainFilter) customQ += ` site:${portalDomainFilter}`;
    if (options.startDate && /^\d{4}-\d{2}-\d{2}$/.test(options.startDate)) {
      customQ += ` after:${options.startDate}`;
    }
    if (options.endDate && /^\d{4}-\d{2}-\d{2}$/.test(options.endDate)) {
      const endObj = new Date(`${options.endDate}T00:00:00Z`);
      if (!isNaN(endObj.getTime())) {
        endObj.setUTCDate(endObj.getUTCDate() + 1);
        customQ += ` before:${endObj.toISOString().slice(0, 10)}`;
      }
    }
    feedTasks.push({
      url: `https://news.google.com/rss/search?q=${encodeURIComponent(customQ)}&hl=bn&gl=BD&ceid=BD:bn`,
      categoryHint: targetCategories[0] || null,
    });
  }

  // Also include direct Bangladeshi news portal RSS feeds when applicable
  for (const portal of BANGLADESH_NEWS_PORTALS) {
    if (portal.rssUrl && (!portalDomainFilter || portal.domain === portalDomainFilter)) {
      feedTasks.push({ url: portal.rssUrl, categoryHint: null });
    }
  }

  const results = await Promise.all(
    feedTasks.map(async (task) => {
      const items = await fetchXmlFeed(task.url);
      return { items, categoryHint: task.categoryHint };
    })
  );

  const deduplicatedMap = new Map<string, ScrapedArticlePayload>();

  for (const { items, categoryHint } of results) {
    for (const item of items) {
      const rawTitle =
        typeof item.title === 'string'
          ? item.title
          : item.title?.['#text']
          ? String(item.title['#text'])
          : '';
      if (!rawTitle || rawTitle.length < 4) continue;

      const rawLink =
        typeof item.link === 'string'
          ? item.link
          : item.link?.['@_href']
          ? String(item.link['@_href'])
          : item.guid?.['#text'] || '';
      if (!rawLink || !rawLink.startsWith('http')) continue;

      const rawSourceTitle =
        typeof item.source === 'string'
          ? item.source
          : item.source?.['#text']
          ? String(item.source['#text'])
          : '';
      const rawSourceUrl = item.source?.['@_url'] ? String(item.source['@_url']) : '';

      const { portalName, portalDomain, cleanTitle } = detectPortal(
        rawSourceTitle,
        rawSourceUrl,
        rawTitle,
        rawLink
      );

      if (
        portalDomainFilter &&
        !portalDomain.toLowerCase().includes(portalDomainFilter.toLowerCase()) &&
        !rawSourceUrl.toLowerCase().includes(portalDomainFilter.toLowerCase())
      ) {
        continue;
      }

      const rawDescription =
        typeof item.description === 'string'
          ? item.description
          : typeof item.summary === 'string'
          ? item.summary
          : '';
      const cleanedDesc = stripHtml(rawDescription);
      const summaryText =
        cleanedDesc && cleanedDesc.length > 15 && cleanedDesc !== cleanTitle
          ? cleanedDesc.slice(0, 1400)
          : `${cleanTitle} — ${portalName} পোর্টালে প্রকাশিত প্রতিবেদন।`;

      const fullSearchableText = `${cleanTitle} ${summaryText}`;
      const matchInfo = classifyAndMatchKeywords(
        fullSearchableText,
        categoryHint,
        categoryKeywordsMap,
        extraKeywordList
      );

      // For direct portal RSS feeds (where categoryHint is null), only keep items that match crime keywords
      if (!categoryHint && !matchInfo) {
        continue;
      }

      const finalCategory: CrimeCategory =
        matchInfo?.category || categoryHint || 'হত্যা/খুন';

      if (!targetCategories.includes(finalCategory)) {
        continue;
      }

      const matchedKeywordsArr =
        matchInfo?.matchedKeywords && matchInfo.matchedKeywords.length > 0
          ? matchInfo.matchedKeywords
          : [
              CRIME_CATEGORIES.find((c) => c.name === finalCategory)?.defaultKeywords[0] ||
                finalCategory,
            ];

      const rawPubDate = item.pubDate || item.published || item.updated || '';
      let pubDateObj = rawPubDate ? new Date(rawPubDate) : new Date();
      if (isNaN(pubDateObj.getTime())) {
        pubDateObj = new Date();
      }

      const publishedDate = toBangladeshDateString(pubDateObj);
      const publishedAt = pubDateObj.toISOString();

      // Enforce date range filter strictly on publishedDate
      if (
        options.startDate &&
        /^\d{4}-\d{2}-\d{2}$/.test(options.startDate) &&
        publishedDate < options.startDate
      ) {
        continue;
      }
      if (
        options.endDate &&
        /^\d{4}-\d{2}-\d{2}$/.test(options.endDate) &&
        publishedDate > options.endDate
      ) {
        continue;
      }

      const district = detectDistrict(fullSearchableText);
      const id = createDeterministicId(rawLink, cleanTitle);

      if (!deduplicatedMap.has(id)) {
        deduplicatedMap.set(id, {
          id,
          title: cleanTitle.slice(0, 390),
          summary: summaryText.slice(0, 1450),
          url: rawLink.slice(0, 990),
          portalName: portalName.slice(0, 115),
          portalDomain: portalDomain.slice(0, 115),
          category: finalCategory,
          matchedKeywords: matchedKeywordsArr.join(', ').slice(0, 490),
          district: district.slice(0, 95),
          publishedDate,
          publishedAt,
        });
      }
    }
  }

  const articles = Array.from(deduplicatedMap.values()).sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt)
  );

  const portalsMatched = Array.from(new Set(articles.map((a) => a.portalName)));

  return {
    articles: articles.slice(0, 160),
    feedsQueried: feedTasks.length,
    portalsMatched,
    scrapedAt: new Date().toISOString(),
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/portals', (_req, res) => {
    res.json({
      portals: BANGLADESH_NEWS_PORTALS,
      categories: CRIME_CATEGORIES,
      districts: BANGLADESH_DISTRICTS,
    });
  });

  app.post('/api/scrape', async (req, res) => {
    try {
      const {
        categories,
        portalDomain,
        startDate,
        endDate,
        customKeywords,
        categoryKeywordsMap,
      } = req.body || {};

      const result = await runLiveScrape({
        categories: Array.isArray(categories) ? categories : undefined,
        portalDomain: typeof portalDomain === 'string' ? portalDomain : undefined,
        startDate: typeof startDate === 'string' ? startDate : undefined,
        endDate: typeof endDate === 'string' ? endDate : undefined,
        customKeywords: typeof customKeywords === 'string' ? customKeywords : undefined,
        categoryKeywordsMap:
          categoryKeywordsMap && typeof categoryKeywordsMap === 'object'
            ? categoryKeywordsMap
            : undefined,
      });

      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Scraping failed',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
