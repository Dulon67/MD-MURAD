import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Search,
  RefreshCw,
  ExternalLink,
  Bookmark,
  Trash2,
  Plus,
  Check,
  X,
  Clock,
  LogIn,
  LogOut,
  FileSpreadsheet,
  FileText,
  FileDown,
  ChevronRight,
  Lock,
} from 'lucide-react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  type Timestamp,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  sanitizeCategory,
  sanitizeDocumentId,
  sanitizePublishedDate,
  sanitizeString,
  sanitizeUrl,
  sanitizeVerificationStatus,
  type VerificationStatus,
} from './firebase';
import {
  CRIME_CATEGORIES,
  BANGLADESH_NEWS_PORTALS,
  BANGLADESH_DISTRICTS,
  type CategoryDefinition,
  type CrimeCategory,
} from './constants/taxonomy';
import {
  exportToCsv,
  exportToExcel,
  exportToWord,
  exportToPdf,
  type ExportReportContext,
} from './utils/exportReports';

export interface NewsArticleRecord {
  id: string;
  ownerId: string;
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
  verificationStatus: VerificationStatus;
  notes: string;
  isBookmarked: boolean;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
  persistedInDb?: boolean;
}

export interface KeywordConfigRecord {
  id: string;
  ownerId: string;
  category: CrimeCategory;
  keywordsCsv: string;
  autoSyncEnabled: boolean;
  syncIntervalMinutes: number;
}

interface LocalCustomCategory {
  id: string;
  name: string;
  keywordsCsv: string;
  description: string;
}

type ActiveTab = 'database' | 'scraper' | 'keywords' | 'analytics';

const STATUS_LABELS: Record<VerificationStatus, string> = {
  unverified: 'অযাচাইকৃত (Unverified)',
  verified: 'যাচাইকৃত (Verified)',
  flagged: 'গুরুত্বপূর্ণ/ফ্ল্যাগড (Flagged)',
  archived: 'আর্কাইভকৃত/লকড (Archived)',
};

const LOCAL_CUSTOM_CATEGORIES_KEY = 'bd_crime_archive_custom_categories_v1';

export default function App() {
  // Auth & Readiness
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Navigation
  const [activeTab, setActiveTab] = useState<ActiveTab>('database');

  // Database Records (Firestore + Live Scraped Session)
  const [dbArticles, setDbArticles] = useState<NewsArticleRecord[]>([]);
  const [liveScrapedArticles, setLiveScrapedArticles] = useState<NewsArticleRecord[]>([]);
  const [keywordConfigs, setKeywordConfigs] = useState<Record<string, KeywordConfigRecord>>({});

  // Local custom categories (used for immediate persistence in browser & synced with Firestore)
  const [localCustomCategories, setLocalCustomCategories] = useState<LocalCustomCategory[]>(() => {
    try {
      const raw = localStorage.getItem(LOCAL_CUSTOM_CATEGORIES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore storage error
    }
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        LOCAL_CUSTOM_CATEGORIES_KEY,
        JSON.stringify(localCustomCategories)
      );
    } catch {
      // Ignore storage error
    }
  }, [localCustomCategories]);

  // Scraping & Auto-Sync State
  const [isScraping, setIsScraping] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [lastScrapeMeta, setLastScrapeMeta] = useState<{
    scrapedAt: string;
    feedsQueried: number;
    totalFound: number;
    newSavedToDb: number;
  } | null>(null);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(15);
  const [secondsUntilNextSync, setSecondsUntilNextSync] = useState(15 * 60);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Filters for Database View
  const [selectedCategory, setSelectedCategory] = useState<CrimeCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [portalFilter, setPortalFilter] = useState('all');
  const [districtFilter, setDistrictFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<VerificationStatus | 'all' | 'bookmarked'>('all');

  // Unified list of Categories (10 Built-in + User Custom Categories from Firestore & LocalStorage)
  const allCategories: CategoryDefinition[] = useMemo(() => {
    const builtInMap = new Set(CRIME_CATEGORIES.map((c) => c.name));
    const customMap = new Map<string, CategoryDefinition>();

    // From local custom categories
    for (const loc of localCustomCategories) {
      if (!builtInMap.has(loc.name)) {
        const kwList = loc.keywordsCsv
          .split(/[,،\n]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        customMap.set(loc.name, {
          id: loc.id,
          name: loc.name,
          englishLabel: 'Custom Category',
          description: loc.description || `${loc.name} সম্পর্কিত সংবাদ ও ঘটনা`,
          defaultKeywords: kwList.length > 0 ? kwList : [loc.name],
          searchQueryTerms: kwList.length > 0 ? kwList.slice(0, 5) : [loc.name],
          isCustom: true,
        });
      }
    }

    // From Firestore keywordConfigs
    for (const cfg of Object.values(keywordConfigs)) {
      if (!builtInMap.has(cfg.category)) {
        const kwList = cfg.keywordsCsv
          .split(/[,،\n]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        customMap.set(cfg.category, {
          id: cfg.id,
          name: cfg.category,
          englishLabel: 'Custom Category',
          description: `${cfg.category} সম্পর্কিত সংবাদ ও ঘটনা`,
          defaultKeywords: kwList.length > 0 ? kwList : [cfg.category],
          searchQueryTerms: kwList.length > 0 ? kwList.slice(0, 5) : [cfg.category],
          isCustom: true,
        });
      }
    }

    return [...CRIME_CATEGORIES, ...Array.from(customMap.values())];
  }, [localCustomCategories, keywordConfigs]);

  // Targeted Live Scraper Console Controls
  const [scraperCategories, setScraperCategories] = useState<CrimeCategory[]>(
    CRIME_CATEGORIES.map((c) => c.name)
  );
  const [scraperPortal, setScraperPortal] = useState('all');
  const [scraperStartDate, setScraperStartDate] = useState('');
  const [scraperEndDate, setScraperEndDate] = useState('');
  const [scraperCustomKeywords, setScraperCustomKeywords] = useState('');

  // Keep scraperCategories synced when new custom categories are added
  useEffect(() => {
    setScraperCategories((prev) => {
      const nextSet = new Set(prev);
      for (const c of allCategories) {
        if (c.isCustom) nextSet.add(c.name);
      }
      return Array.from(nextSet);
    });
  }, [allCategories]);

  // Selected Article Drawer State
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<VerificationStatus>('unverified');
  const [editNotes, setEditNotes] = useState('');
  const [editCategory, setEditCategory] = useState<CrimeCategory>('হত্যা/খুন');
  const [editKeywords, setEditKeywords] = useState('');
  const [editDistrict, setEditDistrict] = useState('ঢাকা');
  const [isSavingArticleEdit, setIsSavingArticleEdit] = useState(false);

  // Manual Entry Modal
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualSummary, setManualSummary] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [manualPortalName, setManualPortalName] = useState('প্রথম আলো');
  const [manualCategory, setManualCategory] = useState<CrimeCategory>('হত্যা/খুন');
  const [manualKeywords, setManualKeywords] = useState('হত্যা, লাশ উদ্ধার');
  const [manualDistrict, setManualDistrict] = useState('ঢাকা');
  const [manualDate, setManualDate] = useState(() => new Date().toISOString().slice(0, 10));

  // New Category Creation Modal State
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryKeywords, setNewCategoryKeywords] = useState('');
  const [newCategoryDescription, setNewCategoryDescription] = useState('');
  const [isAddingCategory, setIsAddingCategory] = useState(false);

  // Keyword Configuration Editor State
  const [editingCategoryKeywords, setEditingCategoryKeywords] = useState<Record<string, string>>({});
  const [savingKeywordCategory, setSavingKeywordCategory] = useState<string | null>(null);

  // Ref to track existing DB IDs for deduplication during auto-sync
  const dbArticleIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    dbArticleIdsRef.current = new Set(dbArticles.map((a) => a.id));
  }, [dbArticles]);

  // 1. Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // 2. Firestore Listeners (when authenticated)
  useEffect(() => {
    if (!authReady || !user) {
      setDbArticles([]);
      setKeywordConfigs({});
      return;
    }

    const articlesPath = 'news_articles';
    const articlesQuery = query(
      collection(db, articlesPath),
      where('ownerId', '==', user.uid)
    );

    const unsubArticles = onSnapshot(
      articlesQuery,
      (snapshot) => {
        const loaded: NewsArticleRecord[] = snapshot.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            ownerId: String(d.ownerId || user.uid),
            title: String(d.title || ''),
            summary: String(d.summary || ''),
            url: String(d.url || ''),
            portalName: String(d.portalName || ''),
            portalDomain: String(d.portalDomain || ''),
            category: sanitizeCategory(d.category),
            matchedKeywords: String(d.matchedKeywords || ''),
            district: String(d.district || 'সারাদেশ'),
            publishedDate: String(d.publishedDate || ''),
            publishedAt: String(d.publishedAt || ''),
            verificationStatus: sanitizeVerificationStatus(d.verificationStatus),
            notes: String(d.notes || ''),
            isBookmarked: Boolean(d.isBookmarked),
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
            persistedInDb: true,
          };
        });
        loaded.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
        setDbArticles(loaded);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, articlesPath);
      }
    );

    const configsPath = 'keyword_configs';
    const configsQuery = query(
      collection(db, configsPath),
      where('ownerId', '==', user.uid)
    );

    const unsubConfigs = onSnapshot(
      configsQuery,
      (snapshot) => {
        const map: Record<string, KeywordConfigRecord> = {};
        snapshot.docs.forEach((docSnap) => {
          const d = docSnap.data();
          const cat = sanitizeCategory(d.category);
          map[cat] = {
            id: docSnap.id,
            ownerId: String(d.ownerId || user.uid),
            category: cat,
            keywordsCsv: String(d.keywordsCsv || ''),
            autoSyncEnabled: Boolean(d.autoSyncEnabled),
            syncIntervalMinutes: Number(d.syncIntervalMinutes || 15),
          };
        });
        setKeywordConfigs(map);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, configsPath);
      }
    );

    return () => {
      unsubArticles();
      unsubConfigs();
    };
  }, [authReady, user]);

  // Build effective category->keywords map combining allCategories + user custom configs
  const effectiveCategoryKeywordsMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const catDef of allCategories) {
      const customCsv = keywordConfigs[catDef.name]?.keywordsCsv;
      if (customCsv) {
        const parsed = customCsv
          .split(/[,،\n]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        map[catDef.name] = Array.from(new Set([...parsed, ...catDef.defaultKeywords]));
      } else {
        map[catDef.name] = catDef.defaultKeywords;
      }
    }
    return map;
  }, [allCategories, keywordConfigs]);

  // Helper to persist a batch of scraped articles into Firestore (deduplicated)
  const syncArticlesToFirestore = useCallback(
    async (incomingArticles: NewsArticleRecord[], currentUser: User): Promise<number> => {
      let savedCount = 0;
      const existingIds = dbArticleIdsRef.current;

      const newItems = incomingArticles.filter((art) => !existingIds.has(art.id)).slice(0, 60);
      for (const art of newItems) {
        const docId = sanitizeDocumentId(art.id);
        const path = `news_articles/${docId}`;
        try {
          await setDoc(doc(db, 'news_articles', docId), {
            ownerId: currentUser.uid,
            title: sanitizeString(art.title, 2, 400, 'সংবাদ শিরোনাম'),
            summary: sanitizeString(art.summary, 1, 1500, art.title),
            url: sanitizeUrl(art.url),
            portalName: sanitizeString(art.portalName, 1, 120, 'বাংলাদেশ নিউজ পোর্টাল'),
            portalDomain: sanitizeString(art.portalDomain, 3, 120, 'news.google.com'),
            category: sanitizeCategory(art.category),
            matchedKeywords: sanitizeString(art.matchedKeywords, 1, 500, art.category),
            district: sanitizeString(art.district, 1, 100, 'সারাদেশ'),
            publishedDate: sanitizePublishedDate(art.publishedDate),
            publishedAt: sanitizeString(art.publishedAt, 10, 40, new Date().toISOString()),
            verificationStatus: 'unverified',
            notes: '',
            isBookmarked: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          savedCount++;
          existingIds.add(docId);
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, path);
        }
      }
      return savedCount;
    },
    []
  );

  // Core Real-Time Scrape Function
  const executeScrape = useCallback(
    async (customParams?: {
      categories?: CrimeCategory[];
      portalDomain?: string;
      startDate?: string;
      endDate?: string;
      customKeywords?: string;
      overrideCategoryKeywordsMap?: Record<string, string[]>;
    }) => {
      setIsScraping(true);
      setStatusBanner('বাংলাদেশের নিউজ পোর্টালগুলো থেকে রিয়েল-টাইম সংবাদ স্ক্র্যাপ করা হচ্ছে...');

      try {
        const activeMap =
          customParams?.overrideCategoryKeywordsMap || effectiveCategoryKeywordsMap;
        const targetCats =
          customParams?.categories && customParams.categories.length > 0
            ? customParams.categories
            : allCategories.map((c) => c.name);

        const response = await fetch('/api/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            categories: targetCats,
            portalDomain: customParams?.portalDomain || 'all',
            startDate: customParams?.startDate || '',
            endDate: customParams?.endDate || '',
            customKeywords: customParams?.customKeywords || '',
            categoryKeywordsMap: activeMap,
          }),
        });

        if (!response.ok) {
          throw new Error(`Scraper HTTP ${response.status}`);
        }

        const data = await response.json();
        const rawList = Array.isArray(data.articles) ? data.articles : [];

        const normalizedList: NewsArticleRecord[] = rawList.map((item: any) => ({
          id: sanitizeDocumentId(String(item.id || `art_${Date.now()}`)),
          ownerId: user?.uid || 'local_session',
          title: sanitizeString(item.title, 2, 400, 'সংবাদ শিরোনাম'),
          summary: sanitizeString(item.summary, 1, 1500, String(item.title || 'সংবাদ বিবরণী')),
          url: sanitizeUrl(item.url),
          portalName: sanitizeString(item.portalName, 1, 120, 'বাংলাদেশ নিউজ পোর্টাল'),
          portalDomain: sanitizeString(item.portalDomain, 3, 120, 'news.google.com'),
          category: sanitizeCategory(item.category),
          matchedKeywords: sanitizeString(item.matchedKeywords, 1, 500, String(item.category || 'অপরাধ')),
          district: sanitizeString(item.district, 1, 100, 'সারাদেশ'),
          publishedDate: sanitizePublishedDate(item.publishedDate),
          publishedAt: sanitizeString(item.publishedAt, 10, 40, new Date().toISOString()),
          verificationStatus: 'unverified',
          notes: '',
          isBookmarked: false,
          persistedInDb: false,
        }));

        // Merge into live session state
        setLiveScrapedArticles((prev) => {
          const map = new Map<string, NewsArticleRecord>();
          for (const item of normalizedList) map.set(item.id, item);
          for (const item of prev) {
            if (!map.has(item.id)) map.set(item.id, item);
          }
          return Array.from(map.values()).sort((a, b) =>
            b.publishedAt.localeCompare(a.publishedAt)
          );
        });

        let savedToFirestore = 0;
        if (user) {
          savedToFirestore = await syncArticlesToFirestore(normalizedList, user);
        }

        setLastScrapeMeta({
          scrapedAt: new Date().toLocaleTimeString('bn-BD'),
          feedsQueried: Number(data.feedsQueried || 10),
          totalFound: normalizedList.length,
          newSavedToDb: savedToFirestore,
        });

        setStatusBanner(
          user
            ? `স্ক্র্যাপিং সম্পন্ন: ${normalizedList.length}টি সংবাদ পাওয়া গেছে, যার মধ্যে ${savedToFirestore}টি নতুন সংবাদ আপনার Firestore ডাটাবেজে জমা হয়েছে।`
            : `স্ক্র্যাপিং সম্পন্ন: ${normalizedList.length}টি রিয়েল-টাইম সংবাদ সংগৃহীত হয়েছে। স্থায়ীভাবে ক্লাউড ডাটাবেজে সংরক্ষণ করতে উপরে ডানদিকে 'ডাটাবেজ লগইন' করুন।`
        );
      } catch (err) {
        console.error('Scrape error:', err);
        setStatusBanner('স্ক্র্যাপিং সম্পন্ন করার সময় সংযোগ বিঘ্নিত হয়েছে। অনুগ্রহ করে পুনরায় চেষ্টা করুন।');
      } finally {
        setIsScraping(false);
        setSecondsUntilNextSync(syncIntervalMinutes * 60);
      }
    },
    [allCategories, effectiveCategoryKeywordsMap, user, syncArticlesToFirestore, syncIntervalMinutes]
  );

  // Initial Scrape on Mount
  const initialScrapeTriggeredRef = useRef(false);
  useEffect(() => {
    if (!initialScrapeTriggeredRef.current) {
      initialScrapeTriggeredRef.current = true;
      executeScrape();
    }
  }, [executeScrape]);

  // When user logs in, automatically sync any live-scraped session articles & local custom categories into Firestore
  const syncedOnLoginRef = useRef<string | null>(null);
  useEffect(() => {
    if (user && syncedOnLoginRef.current !== user.uid) {
      syncedOnLoginRef.current = user.uid;
      if (liveScrapedArticles.length > 0) {
        syncArticlesToFirestore(liveScrapedArticles, user).then((count) => {
          if (count > 0) {
            setStatusBanner(
              `স্বয়ংক্রিয় সিঙ্ক: সেশনের ${count}টি স্ক্র্যাপকৃত সংবাদ আপনার Firestore ডাটাবেজে সংরক্ষিত হয়েছে।`
            );
          }
        });
      }
    }
  }, [user, liveScrapedArticles, syncArticlesToFirestore]);

  // Automatic Background Sync Countdown Timer
  useEffect(() => {
    if (!autoSyncEnabled) return;
    const timer = setInterval(() => {
      setSecondsUntilNextSync((prev) => {
        if (prev <= 1) {
          executeScrape();
          return syncIntervalMinutes * 60;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [autoSyncEnabled, syncIntervalMinutes, executeScrape]);

  // Combined Articles (Firestore DB records take precedence over unpersisted session records)
  const allArticles = useMemo(() => {
    const map = new Map<string, NewsArticleRecord>();
    for (const dbArt of dbArticles) {
      map.set(dbArt.id, { ...dbArt, persistedInDb: true });
    }
    for (const liveArt of liveScrapedArticles) {
      if (!map.has(liveArt.id)) {
        map.set(liveArt.id, { ...liveArt, persistedInDb: false });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      b.publishedAt.localeCompare(a.publishedAt)
    );
  }, [dbArticles, liveScrapedArticles]);

  // Filtered Articles based on Category, Date Range, Portal, District, Status, and Search Query
  const filteredArticles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allArticles.filter((art) => {
      if (selectedCategory !== 'all' && art.category !== selectedCategory) {
        return false;
      }
      if (startDateFilter && art.publishedDate < startDateFilter) {
        return false;
      }
      if (endDateFilter && art.publishedDate > endDateFilter) {
        return false;
      }
      if (
        portalFilter !== 'all' &&
        art.portalDomain !== portalFilter &&
        art.portalName !== portalFilter
      ) {
        return false;
      }
      if (districtFilter !== 'all' && art.district !== districtFilter) {
        return false;
      }
      if (statusFilter === 'bookmarked' && !art.isBookmarked) {
        return false;
      }
      if (
        statusFilter !== 'all' &&
        statusFilter !== 'bookmarked' &&
        art.verificationStatus !== statusFilter
      ) {
        return false;
      }
      if (q) {
        const haystack = `${art.title} ${art.summary} ${art.matchedKeywords} ${art.portalName} ${art.district} ${art.category}`.toLowerCase();
        if (!haystack.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [
    allArticles,
    selectedCategory,
    startDateFilter,
    endDateFilter,
    portalFilter,
    districtFilter,
    statusFilter,
    searchQuery,
  ]);

  // Category Counts for Filter Tabs
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allArticles.length };
    for (const c of allCategories) {
      counts[c.name] = 0;
    }
    for (const art of allArticles) {
      counts[art.category] = (counts[art.category] || 0) + 1;
    }
    return counts;
  }, [allArticles, allCategories]);

  // Selected Article for Drawer
  const selectedArticle = useMemo(
    () => allArticles.find((a) => a.id === selectedArticleId) || null,
    [allArticles, selectedArticleId]
  );

  useEffect(() => {
    if (selectedArticle) {
      setEditStatus(selectedArticle.verificationStatus);
      setEditNotes(selectedArticle.notes);
      setEditCategory(selectedArticle.category);
      setEditKeywords(selectedArticle.matchedKeywords);
      setEditDistrict(selectedArticle.district);
    }
  }, [selectedArticle]);

  // Quick Date Range Helper
  const applyDatePreset = (daysBack: number | null) => {
    if (daysBack === null) {
      setStartDateFilter('');
      setEndDateFilter('');
      return;
    }
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - daysBack);
    setStartDateFilter(start.toISOString().slice(0, 10));
    setEndDateFilter(end.toISOString().slice(0, 10));
  };

  // Google Sign-In Handler
  const handleSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'গুগল লগইন সম্পন্ন করা যায়নি।'
      );
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  // Add New Custom Category & Immediately Scrape News for It
  const handleCreateNewCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = sanitizeCategory(newCategoryName);
    if (cleanName.length < 2) return;

    const rawKeywords = newCategoryKeywords.trim() || cleanName;
    const cleanedCsv = sanitizeString(rawKeywords, 1, 1000, cleanName);
    const parsedKeywords = cleanedCsv
      .split(/[,،\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const finalKeywords = parsedKeywords.length > 0 ? parsedKeywords : [cleanName];

    setIsAddingCategory(true);
    try {
      const customId = sanitizeDocumentId(`custom_${Date.now()}`);

      // 1. Save to local state / localStorage so it's immediately available
      setLocalCustomCategories((prev) => {
        const filtered = prev.filter((c) => c.name !== cleanName);
        return [
          ...filtered,
          {
            id: customId,
            name: cleanName,
            keywordsCsv: finalKeywords.join(', '),
            description: newCategoryDescription.trim() || `${cleanName} সম্পর্কিত সংবাদ`,
          },
        ];
      });

      // 2. If signed in, persist to Firestore `/keyword_configs/{configId}`
      if (user) {
        const existingCfg = keywordConfigs[cleanName];
        const docId = existingCfg
          ? existingCfg.id
          : sanitizeDocumentId(`cfg_${user.uid.slice(0, 18)}_${Date.now()}`);
        const path = `keyword_configs/${docId}`;
        try {
          if (!existingCfg) {
            await setDoc(doc(db, 'keyword_configs', docId), {
              ownerId: user.uid,
              category: cleanName,
              keywordsCsv: finalKeywords.join(', '),
              autoSyncEnabled: autoSyncEnabled,
              syncIntervalMinutes: syncIntervalMinutes,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            await updateDoc(doc(db, 'keyword_configs', docId), {
              keywordsCsv: finalKeywords.join(', '),
              updatedAt: serverTimestamp(),
            });
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, path);
        }
      }

      // 3. Close modal & reset inputs
      setShowAddCategoryModal(false);
      setNewCategoryName('');
      setNewCategoryKeywords('');
      setNewCategoryDescription('');

      // 4. Select the new category and immediately scrape real-time news for it!
      setSelectedCategory(cleanName);
      const updatedMap: Record<string, string[]> = {
        ...effectiveCategoryKeywordsMap,
        [cleanName]: finalKeywords,
      };
      await executeScrape({
        categories: [cleanName],
        overrideCategoryKeywordsMap: updatedMap,
      });
    } finally {
      setIsAddingCategory(false);
    }
  };

  // Delete Custom Category
  const handleDeleteCustomCategory = async (catDef: CategoryDefinition) => {
    if (!catDef.isCustom) return;
    setLocalCustomCategories((prev) => prev.filter((c) => c.name !== catDef.name));
    if (selectedCategory === catDef.name) {
      setSelectedCategory('all');
    }

    const existingCfg = keywordConfigs[catDef.name];
    if (user && existingCfg) {
      const path = `keyword_configs/${existingCfg.id}`;
      try {
        await deleteDoc(doc(db, 'keyword_configs', existingCfg.id));
        setStatusBanner(`"${catDef.name}" কাস্টম ক্যাটাগরিটি মুছে ফেলা হয়েছে।`);
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
      }
    } else {
      setStatusBanner(`"${catDef.name}" কাস্টম ক্যাটাগরিটি মুছে ফেলা হয়েছে।`);
    }
  };

  // Toggle Bookmark
  const handleToggleBookmark = async (article: NewsArticleRecord, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const nextBookmark = !article.isBookmarked;

    if (!user) {
      setLiveScrapedArticles((prev) =>
        prev.map((a) => (a.id === article.id ? { ...a, isBookmarked: nextBookmark } : a))
      );
      return;
    }

    if (article.verificationStatus === 'archived') {
      setStatusBanner('আর্কাইভকৃত (লকড) সংবাদের তথ্য পরিবর্তন করা যাবে না।');
      return;
    }

    const docId = sanitizeDocumentId(article.id);
    const path = `news_articles/${docId}`;
    try {
      if (!article.persistedInDb) {
        await setDoc(doc(db, 'news_articles', docId), {
          ownerId: user.uid,
          title: sanitizeString(article.title, 2, 400, 'সংবাদ শিরোনাম'),
          summary: sanitizeString(article.summary, 1, 1500, article.title),
          url: sanitizeUrl(article.url),
          portalName: sanitizeString(article.portalName, 1, 120, 'বাংলাদেশ নিউজ পোর্টাল'),
          portalDomain: sanitizeString(article.portalDomain, 3, 120, 'news.google.com'),
          category: sanitizeCategory(article.category),
          matchedKeywords: sanitizeString(article.matchedKeywords, 1, 500, article.category),
          district: sanitizeString(article.district, 1, 100, 'সারাদেশ'),
          publishedDate: sanitizePublishedDate(article.publishedDate),
          publishedAt: sanitizeString(article.publishedAt, 10, 40, new Date().toISOString()),
          verificationStatus: sanitizeVerificationStatus(article.verificationStatus),
          notes: sanitizeString(article.notes, 0, 1000, ''),
          isBookmarked: nextBookmark,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, 'news_articles', docId), {
          isBookmarked: nextBookmark,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  // Action 2: Update verificationStatus & notes
  const handleSaveStatusAndNotes = async () => {
    if (!selectedArticle) return;
    if (selectedArticle.verificationStatus === 'archived') return;

    setIsSavingArticleEdit(true);
    try {
      if (!user) {
        setLiveScrapedArticles((prev) =>
          prev.map((a) =>
            a.id === selectedArticle.id
              ? {
                  ...a,
                  verificationStatus: editStatus,
                  notes: editNotes.slice(0, 1000),
                }
              : a
          )
        );
        setStatusBanner('সেশন মেমোরিতে নোট ও স্ট্যাটাস আপডেট হয়েছে (স্থায়ী সংরক্ষণের জন্য লগইন করুন)।');
        return;
      }

      const docId = sanitizeDocumentId(selectedArticle.id);
      const path = `news_articles/${docId}`;
      try {
        if (!selectedArticle.persistedInDb) {
          await setDoc(doc(db, 'news_articles', docId), {
            ownerId: user.uid,
            title: sanitizeString(selectedArticle.title, 2, 400, 'সংবাদ শিরোনাম'),
            summary: sanitizeString(selectedArticle.summary, 1, 1500, selectedArticle.title),
            url: sanitizeUrl(selectedArticle.url),
            portalName: sanitizeString(selectedArticle.portalName, 1, 120, 'বাংলাদেশ নিউজ পোর্টাল'),
            portalDomain: sanitizeString(selectedArticle.portalDomain, 3, 120, 'news.google.com'),
            category: sanitizeCategory(selectedArticle.category),
            matchedKeywords: sanitizeString(selectedArticle.matchedKeywords, 1, 500, selectedArticle.category),
            district: sanitizeString(selectedArticle.district, 1, 100, 'সারাদেশ'),
            publishedDate: sanitizePublishedDate(selectedArticle.publishedDate),
            publishedAt: sanitizeString(selectedArticle.publishedAt, 10, 40, new Date().toISOString()),
            verificationStatus: sanitizeVerificationStatus(editStatus),
            notes: editNotes.trim().slice(0, 1000),
            isBookmarked: selectedArticle.isBookmarked,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(doc(db, 'news_articles', docId), {
            verificationStatus: sanitizeVerificationStatus(editStatus),
            notes: editNotes.trim().slice(0, 1000),
            updatedAt: serverTimestamp(),
          });
        }
        setStatusBanner('Firestore ডাটাবেজে সংবাদের স্ট্যাটাস ও তদন্ত নোট সংরক্ষিত হয়েছে।');
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }
    } finally {
      setIsSavingArticleEdit(false);
    }
  };

  // Action 3: Reclassify category, matchedKeywords, district
  const handleSaveClassification = async () => {
    if (!selectedArticle) return;
    if (selectedArticle.verificationStatus === 'archived') return;

    setIsSavingArticleEdit(true);
    try {
      if (!user) {
        setLiveScrapedArticles((prev) =>
          prev.map((a) =>
            a.id === selectedArticle.id
              ? {
                  ...a,
                  category: editCategory,
                  matchedKeywords: sanitizeString(editKeywords, 1, 500, editCategory),
                  district: sanitizeString(editDistrict, 1, 100, 'সারাদেশ'),
                }
              : a
          )
        );
        setStatusBanner('সেশন মেমোরিতে ক্যাটাগরি ও জেলা আপডেট হয়েছে।');
        return;
      }

      const docId = sanitizeDocumentId(selectedArticle.id);
      const path = `news_articles/${docId}`;
      try {
        if (!selectedArticle.persistedInDb) {
          await setDoc(doc(db, 'news_articles', docId), {
            ownerId: user.uid,
            title: sanitizeString(selectedArticle.title, 2, 400, 'সংবাদ শিরোনাম'),
            summary: sanitizeString(selectedArticle.summary, 1, 1500, selectedArticle.title),
            url: sanitizeUrl(selectedArticle.url),
            portalName: sanitizeString(selectedArticle.portalName, 1, 120, 'বাংলাদেশ নিউজ পোর্টাল'),
            portalDomain: sanitizeString(selectedArticle.portalDomain, 3, 120, 'news.google.com'),
            category: sanitizeCategory(editCategory),
            matchedKeywords: sanitizeString(editKeywords, 1, 500, editCategory),
            district: sanitizeString(editDistrict, 1, 100, 'সারাদেশ'),
            publishedDate: sanitizePublishedDate(selectedArticle.publishedDate),
            publishedAt: sanitizeString(selectedArticle.publishedAt, 10, 40, new Date().toISOString()),
            verificationStatus: sanitizeVerificationStatus(selectedArticle.verificationStatus),
            notes: sanitizeString(selectedArticle.notes, 0, 1000, ''),
            isBookmarked: selectedArticle.isBookmarked,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(doc(db, 'news_articles', docId), {
            category: sanitizeCategory(editCategory),
            matchedKeywords: sanitizeString(editKeywords, 1, 500, editCategory),
            district: sanitizeString(editDistrict, 1, 100, 'সারাদেশ'),
            updatedAt: serverTimestamp(),
          });
        }
        setStatusBanner('Firestore ডাটাবেজে সংবাদের ক্যাটাগরি, কি-ওয়ার্ড ও জেলা আপডেট হয়েছে।');
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }
    } finally {
      setIsSavingArticleEdit(false);
    }
  };

  // Delete Article
  const handleDeleteArticle = async (article: NewsArticleRecord) => {
    setLiveScrapedArticles((prev) => prev.filter((a) => a.id !== article.id));
    if (selectedArticleId === article.id) {
      setSelectedArticleId(null);
    }

    if (user && article.persistedInDb) {
      const docId = sanitizeDocumentId(article.id);
      const path = `news_articles/${docId}`;
      try {
        await deleteDoc(doc(db, 'news_articles', docId));
        setStatusBanner('সংবাদটি ডাটাবেজ থেকে মুছে ফেলা হয়েছে।');
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
      }
    }
  };

  // Manual Entry Handler
  const handleAddManualArticle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (manualTitle.trim().length < 2) return;

    const portalInfo =
      BANGLADESH_NEWS_PORTALS.find((p) => p.name === manualPortalName) ||
      BANGLADESH_NEWS_PORTALS[0];
    const docId = sanitizeDocumentId(`manual_${Date.now()}`);
    const pubDate = sanitizePublishedDate(manualDate);
    const pubIso = new Date(`${pubDate}T12:00:00Z`).toISOString();

    const newRecord: NewsArticleRecord = {
      id: docId,
      ownerId: user?.uid || 'local_session',
      title: sanitizeString(manualTitle, 2, 400, 'সংবাদ শিরোনাম'),
      summary: sanitizeString(manualSummary || manualTitle, 1, 1500, manualTitle),
      url: sanitizeUrl(manualUrl || `https://${portalInfo.domain}`),
      portalName: portalInfo.name,
      portalDomain: portalInfo.domain,
      category: sanitizeCategory(manualCategory),
      matchedKeywords: sanitizeString(manualKeywords, 1, 500, manualCategory),
      district: sanitizeString(manualDistrict, 1, 100, 'ঢাকা'),
      publishedDate: pubDate,
      publishedAt: pubIso,
      verificationStatus: 'verified',
      notes: 'ম্যানুয়াল এন্ট্রি',
      isBookmarked: false,
      persistedInDb: Boolean(user),
    };

    if (user) {
      const path = `news_articles/${docId}`;
      try {
        await setDoc(doc(db, 'news_articles', docId), {
          ownerId: user.uid,
          title: newRecord.title,
          summary: newRecord.summary,
          url: newRecord.url,
          portalName: newRecord.portalName,
          portalDomain: newRecord.portalDomain,
          category: newRecord.category,
          matchedKeywords: newRecord.matchedKeywords,
          district: newRecord.district,
          publishedDate: newRecord.publishedDate,
          publishedAt: newRecord.publishedAt,
          verificationStatus: 'verified',
          notes: 'ম্যানুয়াল এন্ট্রি',
          isBookmarked: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, path);
      }
    } else {
      setLiveScrapedArticles((prev) => [newRecord, ...prev]);
    }

    setShowManualModal(false);
    setManualTitle('');
    setManualSummary('');
    setManualUrl('');
    setStatusBanner('নতুন সংবাদ রেকর্ড সফলভাবে ডাটাবেজে যুক্ত করা হয়েছে।');
  };

  // Save Custom Keyword Configuration per Category in Firestore & LocalStorage
  const handleSaveCategoryKeywords = async (catDef: CategoryDefinition) => {
    const rawCsv =
      editingCategoryKeywords[catDef.name] ??
      keywordConfigs[catDef.name]?.keywordsCsv ??
      catDef.defaultKeywords.join(', ');

    const cleanedCsv = sanitizeString(rawCsv, 1, 1000, catDef.defaultKeywords.join(', '));
    const parsedKeywords = cleanedCsv
      .split(/[,،\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    // Update local custom category if applicable
    if (catDef.isCustom) {
      setLocalCustomCategories((prev) =>
        prev.map((c) => (c.name === catDef.name ? { ...c, keywordsCsv: cleanedCsv } : c))
      );
    }

    setSavingKeywordCategory(catDef.name);
    try {
      if (user) {
        const existingCfg = keywordConfigs[catDef.name];
        const configId = existingCfg
          ? existingCfg.id
          : sanitizeDocumentId(`cfg_${user.uid.slice(0, 18)}_${catDef.id}`);
        const path = `keyword_configs/${configId}`;

        try {
          if (!existingCfg) {
            await setDoc(doc(db, 'keyword_configs', configId), {
              ownerId: user.uid,
              category: catDef.name,
              keywordsCsv: cleanedCsv,
              autoSyncEnabled: autoSyncEnabled,
              syncIntervalMinutes: syncIntervalMinutes,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            await updateDoc(doc(db, 'keyword_configs', existingCfg.id), {
              keywordsCsv: cleanedCsv,
              updatedAt: serverTimestamp(),
            });
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, path);
        }
      }

      // Immediately scrape fresh news for this updated category!
      const updatedMap: Record<string, string[]> = {
        ...effectiveCategoryKeywordsMap,
        [catDef.name]: parsedKeywords.length > 0 ? parsedKeywords : [catDef.name],
      };
      await executeScrape({
        categories: [catDef.name],
        overrideCategoryKeywordsMap: updatedMap,
      });
      setStatusBanner(
        `"${catDef.name}" ক্যাটাগরির কি-ওয়ার্ড আপডেট হয়েছে এবং নতুন সংবাদ স্ক্র্যাপ করা হয়েছে।`
      );
    } finally {
      setSavingKeywordCategory(null);
    }
  };

  // Multi-Format Report Export Context
  const reportExportContext: ExportReportContext = useMemo(
    () => ({
      articles: filteredArticles,
      allCategories,
      categoryCounts,
      selectedCategory,
      startDateFilter,
      endDateFilter,
      portalFilter,
      districtFilter,
      searchQuery,
    }),
    [
      filteredArticles,
      allCategories,
      categoryCounts,
      selectedCategory,
      startDateFilter,
      endDateFilter,
      portalFilter,
      districtFilter,
      searchQuery,
    ]
  );

  const handleDownloadPdf = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    setStatusBanner('PDF রিপোর্ট তৈরি করা হচ্ছে, অনুগ্রহ করে কিছুক্ষণ অপেক্ষা করুন...');
    try {
      await exportToPdf(reportExportContext);
      setStatusBanner('PDF রিপোর্ট সফলভাবে ডাউনলোড হয়েছে।');
    } catch (err) {
      console.error('PDF export error:', err);
      setStatusBanner('PDF তৈরিতে সমস্যা হয়েছে। অনুগ্রহ করে পুনরায় চেষ্টা করুন।');
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Format countdown timer MM:SS
  const formattedCountdown = useMemo(() => {
    const mins = Math.floor(secondsUntilNextSync / 60);
    const secs = secondsUntilNextSync % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, [secondsUntilNextSync]);

  // Analytics Breakdown Data
  const analyticsData = useMemo(() => {
    const byPortal: Record<string, number> = {};
    const byDistrict: Record<string, number> = {};
    const byDate: Record<string, number> = {};

    for (const art of filteredArticles) {
      byPortal[art.portalName] = (byPortal[art.portalName] || 0) + 1;
      byDistrict[art.district] = (byDistrict[art.district] || 0) + 1;
      byDate[art.publishedDate] = (byDate[art.publishedDate] || 0) + 1;
    }

    const topPortals = Object.entries(byPortal)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
    const topDistricts = Object.entries(byDistrict)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
    const timeline = Object.entries(byDate)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 14);

    return { topPortals, topDistricts, timeline };
  }, [filteredArticles]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar Contract: Strictly 1 row, 3 zones (Brand Wordmark | 4 Nav Links | 2 Primary Actions) */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#database"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('database');
          }}
          className="text-lg font-semibold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          BD Crime Archive
        </a>

        {/* Zone 2: 4 Clean Navigation Links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
          <button
            type="button"
            onClick={() => setActiveTab('database')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              activeTab === 'database'
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            সংবাদ ডাটাবেজ
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('scraper')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              activeTab === 'scraper'
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            লাইভ স্ক্র্যাপার
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('keywords')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              activeTab === 'keywords'
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            ক্যাটাগরি ও কি-ওয়ার্ড
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('analytics')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              activeTab === 'analytics'
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            বিশ্লেষণ ও রিপোর্ট
          </button>
        </nav>

        {/* Zone 3: 2 Primary Actions */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={isScraping}
            onClick={() =>
              executeScrape({
                startDate: startDateFilter,
                endDate: endDateFilter,
                portalDomain: portalFilter,
                categories:
                  selectedCategory === 'all' ? undefined : [selectedCategory],
              })
            }
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-red-700 rounded-md hover:bg-red-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScraping ? 'animate-spin' : ''}`} />
            <span>{isScraping ? 'স্ক্র্যাপ চলছে...' : 'এখনই স্ক্র্যাপ করুন'}</span>
          </button>

          {user ? (
            <button
              type="button"
              onClick={handleSignOut}
              title={`লগইনকৃত: ${user.email || user.displayName || ''}`}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="max-w-[110px] truncate">
                {user.displayName || user.email || 'লগআউট'}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSignIn}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-900 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>ডাটাবেজ লগইন</span>
            </button>
          )}
        </div>
      </header>

      {/* Mobile Navigation Bar */}
      <div className="md:hidden bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-2 overflow-x-auto">
        {(
          [
            ['database', 'সংবাদ ডাটাবেজ'],
            ['scraper', 'লাইভ স্ক্র্যাপার'],
            ['keywords', 'ক্যাটাগরি ও কি-ওয়ার্ড'],
            ['analytics', 'বিশ্লেষণ ও রিপোর্ট'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === key
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Main Workspace Container */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-6 space-y-6">
        {/* Contextual Workspace Header, Auto-Update Controls & Multi-Format Export Bar */}
        <section className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold text-slate-900">
              বাংলাদেশ অপরাধ ও ঘটনা সংবাদ আর্কাইভ এবং অটোমেটিক স্ক্র্যাপার ডাটাবেজ
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span>মোট সংরক্ষিত সংবাদ: <strong className="font-mono-tabular text-slate-900">{allArticles.length}</strong></span>
              <span aria-hidden="true">·</span>
              <span>ফিল্টারকৃত ফলাফল: <strong className="font-mono-tabular text-slate-900">{filteredArticles.length}</strong></span>
              <span aria-hidden="true">·</span>
              <span>সক্রিয় ক্যাটাগরি: <strong className="font-mono-tabular text-slate-900">{allCategories.length}টি</strong></span>
              <span aria-hidden="true">·</span>
              <span>ডাটাবেজ: <strong className="text-slate-900">{user ? 'Firestore সংযুক্ত' : 'লাইভ সেশন'}</strong></span>
              {lastScrapeMeta && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>সর্বশেষ আপডেট: <strong className="font-mono-tabular text-slate-900">{lastScrapeMeta.scrapedAt}</strong></span>
                </>
              )}
            </div>
          </div>

          {/* Auto-Sync Scheduler, Add Category, Manual Entry & 4-Format Report Download Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-md text-xs">
              <Clock className="w-3.5 h-3.5 text-slate-600 shrink-0" />
              <span className="text-slate-700 font-medium whitespace-nowrap">
                অটো-আপডেট:
              </span>
              <button
                type="button"
                onClick={() => setAutoSyncEnabled((v) => !v)}
                className={`px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                  autoSyncEnabled
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-300 text-slate-700'
                }`}
              >
                {autoSyncEnabled ? `চালু (${formattedCountdown})` : 'বন্ধ'}
              </button>
              <select
                aria-label="অটো আপডেট বিরতি"
                value={syncIntervalMinutes}
                onChange={(e) => {
                  const mins = Number(e.target.value);
                  setSyncIntervalMinutes(mins);
                  setSecondsUntilNextSync(mins * 60);
                }}
                className="bg-white border border-slate-200 rounded px-2 py-0.5 text-xs font-mono-tabular text-slate-800"
              >
                <option value={5}>৫ মিনিট</option>
                <option value={15}>১৫ মিনিট</option>
                <option value={30}>৩০ মিনিট</option>
                <option value={60}>৬০ মিনিট</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => setShowAddCategoryModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>নতুন ক্যাটাগরি যোগ</span>
            </button>

            <button
              type="button"
              onClick={() => setShowManualModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>ম্যানুয়াল সংবাদ</span>
            </button>

            {/* 4-Format Download Group: CSV, Excel, Word, PDF */}
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-md">
              <button
                type="button"
                onClick={() => exportToCsv(reportExportContext)}
                title="CSV ফরম্যাটে রিপোর্ট ডাউনলোড করুন"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                <span>CSV</span>
              </button>

              <button
                type="button"
                onClick={() => exportToExcel(reportExportContext)}
                title="Microsoft Excel (.xlsx) ফরম্যাটে রিপোর্ট ডাউনলোড করুন"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-green-700" />
                <span>Excel</span>
              </button>

              <button
                type="button"
                onClick={() => exportToWord(reportExportContext)}
                title="Microsoft Word (.doc) ফরম্যাটে রিপোর্ট ডাউনলোড করুন"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5 text-blue-700" />
                <span>Word</span>
              </button>

              <button
                type="button"
                disabled={isExportingPdf}
                onClick={handleDownloadPdf}
                title="PDF (.pdf) ফরম্যাটে রিপোর্ট ডাউনলোড করুন"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileDown className="w-3.5 h-3.5 text-red-700" />
                <span>{isExportingPdf ? 'PDF...' : 'PDF'}</span>
              </button>
            </div>
          </div>
        </section>

        {/* Status / Notification Bar */}
        {(statusBanner || authError) && (
          <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex items-center justify-between gap-4 text-xs text-slate-700">
            <span>{authError || statusBanner}</span>
            <button
              type="button"
              onClick={() => {
                setStatusBanner(null);
                setAuthError(null);
              }}
              className="text-slate-400 hover:text-slate-700 cursor-pointer"
              aria-label="বার্তা বন্ধ করুন"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* TAB 1: NEWS DATABASE VIEW (সংবাদ ডাটাবেজ ও তারিখ ফিল্টার) */}
        {activeTab === 'database' && (
          <div className="space-y-5">
            {/* Multi-Criteria Filter & Date Range Panel */}
            <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              {/* Row 1: Crime & Incident Category Interactive Filter Buttons + Add Category Button */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700">
                    ০১. অপরাধ ও ঘটনা ক্যাটাগরি ফিল্টার ({allCategories.length}টি বিভাগ)
                  </span>
                  <div className="flex items-center gap-3">
                    {selectedCategory !== 'all' && (
                      <button
                        type="button"
                        onClick={() => setSelectedCategory('all')}
                        className="text-xs text-red-700 hover:underline font-medium cursor-pointer"
                      >
                        সকল ক্যাটাগরি দেখুন
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowAddCategoryModal(true)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-900 hover:underline cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>নতুন ক্যাটাগরি যুক্ত করুন</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setSelectedCategory('all')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      selectedCategory === 'all'
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'text-slate-700 hover:text-slate-900 hover:bg-white/60'
                    }`}
                  >
                    সকল ক্যাটাগরি ({categoryCounts.all || 0})
                  </button>
                  {allCategories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCategory(cat.name)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        selectedCategory === cat.name
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'text-slate-700 hover:text-slate-900 hover:bg-white/60'
                      }`}
                    >
                      {cat.name} (<span className="font-mono-tabular">{categoryCounts[cat.name] || 0}</span>)
                    </button>
                  ))}
                </div>
              </div>

              {/* Row 2: Search Input + Date Filter Range + Portal & District Selectors */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-3 pt-2 border-t border-slate-100">
                {/* Keyword / Headline Search */}
                <div className="lg:col-span-4">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    কি-ওয়ার্ড, শিরোনাম বা স্থান দিয়ে সার্চ করুন
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="যেমন: হত্যা, ডাকাতি, রাঙামাটি, ইয়াবা, অনলাইন জুয়া..."
                      className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900 focus:bg-white"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Start Date Filter */}
                <div className="lg:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    শুরুর তারিখ (From Date)
                  </label>
                  <input
                    type="date"
                    value={startDateFilter}
                    onChange={(e) => setStartDateFilter(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono-tabular bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900 focus:bg-white"
                  />
                </div>

                {/* End Date Filter */}
                <div className="lg:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    শেষ তারিখ (To Date)
                  </label>
                  <input
                    type="date"
                    value={endDateFilter}
                    onChange={(e) => setEndDateFilter(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono-tabular bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900 focus:bg-white"
                  />
                </div>

                {/* News Portal Filter */}
                <div className="lg:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    নিউজ পোর্টাল ফিল্টার
                  </label>
                  <select
                    value={portalFilter}
                    onChange={(e) => setPortalFilter(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900 focus:bg-white"
                  >
                    <option value="all">সকল নিউজ পোর্টাল</option>
                    {BANGLADESH_NEWS_PORTALS.map((p) => (
                      <option key={p.id} value={p.domain}>
                        {p.name} ({p.englishName})
                      </option>
                    ))}
                  </select>
                </div>

                {/* District Filter */}
                <div className="lg:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    জেলা / অঞ্চল ফিল্টার
                  </label>
                  <select
                    value={districtFilter}
                    onChange={(e) => setDistrictFilter(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900 focus:bg-white"
                  >
                    <option value="all">সকল জেলা (সারাদেশ)</option>
                    <option value="সারাদেশ">সারাদেশ</option>
                    <option value="পার্বত্য অঞ্চল">পার্বত্য অঞ্চল</option>
                    {BANGLADESH_DISTRICTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Row 3: Quick Date Presets, Verification Status Filter & Targeted Scrape Button */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-slate-500 mr-1">দ্রুত তারিখ ফিল্টার:</span>
                  <button
                    type="button"
                    onClick={() => applyDatePreset(null)}
                    className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap cursor-pointer ${
                      !startDateFilter && !endDateFilter
                        ? 'bg-slate-900 text-white font-medium'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    সকল তারিখ
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset(0)}
                    className="px-2.5 py-1 text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 rounded transition-colors whitespace-nowrap cursor-pointer"
                  >
                    আজকের সংবাদ
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset(3)}
                    className="px-2.5 py-1 text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 rounded transition-colors whitespace-nowrap cursor-pointer"
                  >
                    গত ৩ দিন
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset(7)}
                    className="px-2.5 py-1 text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 rounded transition-colors whitespace-nowrap cursor-pointer"
                  >
                    গত ৭ দিন
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset(30)}
                    className="px-2.5 py-1 text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 rounded transition-colors whitespace-nowrap cursor-pointer"
                  >
                    গত ৩০ দিন
                  </button>

                  {(startDateFilter || endDateFilter || selectedCategory !== 'all') && (
                    <button
                      type="button"
                      disabled={isScraping}
                      onClick={() =>
                        executeScrape({
                          startDate: startDateFilter,
                          endDate: endDateFilter,
                          portalDomain: portalFilter,
                          categories:
                            selectedCategory === 'all' ? undefined : [selectedCategory],
                          customKeywords: searchQuery,
                        })
                      }
                      className="ml-2 px-3 py-1 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 rounded transition-colors whitespace-nowrap cursor-pointer"
                    >
                      নির্বাচিত ফিল্টারে পোর্টাল থেকে লাইভ স্ক্র্যাপ করুন
                    </button>
                  )}
                </div>

                {/* Status Filter Segmented Controls */}
                <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-md">
                  {(
                    [
                      ['all', 'সকল স্ট্যাটাস'],
                      ['unverified', 'অযাচাইকৃত'],
                      ['verified', 'যাচাইকৃত'],
                      ['flagged', 'ফ্ল্যাগড'],
                      ['archived', 'আর্কাইভকৃত'],
                      ['bookmarked', 'বুকমার্ককৃত'],
                    ] as const
                  ).map(([st, label]) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap cursor-pointer ${
                        statusFilter === st
                          ? 'bg-white text-slate-900 font-semibold shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Main Data Grid + Side Investigation Drawer */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Data Table Column */}
              <div
                className={`${
                  selectedArticle ? 'lg:col-span-7' : 'lg:col-span-12'
                } bg-white border border-slate-200 rounded-lg overflow-hidden`}
              >
                {isScraping && allArticles.length === 0 ? (
                  <div className="p-8 space-y-3">
                    <p className="text-xs text-slate-500 font-medium">
                      বাংলাদেশের নিউজ পোর্টালগুলো থেকে রিয়েল-টাইম তথ্য স্ক্র্যাপ করা হচ্ছে...
                    </p>
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <div
                        key={n}
                        className="h-10 bg-slate-100 animate-pulse rounded"
                      />
                    ))}
                  </div>
                ) : filteredArticles.length === 0 ? (
                  <div className="p-12 text-center space-y-3">
                    <p className="text-sm font-semibold text-slate-800">
                      নির্বাচিত ফিল্টারে কোনো সংবাদ পাওয়া যায়নি
                    </p>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                      তারিখ সীমা বা কি-ওয়ার্ড ফিল্টার পরিবর্তন করুন অথবা নিচের বাটনে ক্লিক করে বাংলাদেশের সকল নিউজ পোর্টাল থেকে নতুন সংবাদ স্ক্র্যাপ করুন।
                    </p>
                    <div className="pt-2 flex items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCategory('all');
                          setSearchQuery('');
                          setStartDateFilter('');
                          setEndDateFilter('');
                          setPortalFilter('all');
                          setDistrictFilter('all');
                          setStatusFilter('all');
                        }}
                        className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors cursor-pointer"
                      >
                        সকল ফিল্টার রিসেট করুন
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          executeScrape({
                            startDate: startDateFilter,
                            endDate: endDateFilter,
                            categories:
                              selectedCategory === 'all' ? undefined : [selectedCategory],
                            customKeywords: searchQuery,
                          })
                        }
                        className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors cursor-pointer"
                      >
                        পোর্টাল থেকে লাইভ স্ক্র্যাপ করুন
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                          <th className="py-3 px-4 whitespace-nowrap">তারিখ</th>
                          <th className="py-3 px-4">সংবাদ শিরোনাম ও কি-ওয়ার্ড মেটাডেটা</th>
                          <th className="py-3 px-4 whitespace-nowrap">পোর্টাল ও জেলা</th>
                          <th className="py-3 px-4 whitespace-nowrap">স্ট্যাটাস</th>
                          <th className="py-3 px-4 text-right whitespace-nowrap">অ্যাকশন</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-xs">
                        {filteredArticles.map((art) => {
                          const isSelected = selectedArticleId === art.id;
                          return (
                            <tr
                              key={art.id}
                              onClick={() => setSelectedArticleId(art.id)}
                              className={`transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-slate-100'
                                  : 'hover:bg-slate-50'
                              }`}
                            >
                              {/* Date Column (Tabular Numerals) */}
                              <td className="py-3 px-4 align-top whitespace-nowrap font-mono-tabular text-slate-700">
                                <div>{art.publishedDate}</div>
                                <div className="text-[11px] text-slate-400">
                                  {art.persistedInDb ? 'DB Saved' : 'Live Feed'}
                                </div>
                              </td>

                              {/* Headline & Zero-Pill Unboxed Metadata */}
                              <td className="py-3 px-4 align-top max-w-xl">
                                <div className="font-semibold text-sm text-slate-900 leading-snug mb-1">
                                  {art.title}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                                  <span className="font-semibold text-red-700">
                                    {art.category}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span>কি-ওয়ার্ড: {art.matchedKeywords}</span>
                                </div>
                              </td>

                              {/* Portal & District */}
                              <td className="py-3 px-4 align-top whitespace-nowrap text-slate-700">
                                <div className="font-medium text-slate-900">
                                  {art.portalName}
                                </div>
                                <div className="text-slate-500">
                                  জেলা: {art.district}
                                </div>
                              </td>

                              {/* Status Text */}
                              <td className="py-3 px-4 align-top whitespace-nowrap">
                                <span
                                  className={`font-medium ${
                                    art.verificationStatus === 'verified'
                                      ? 'text-emerald-700'
                                      : art.verificationStatus === 'flagged'
                                      ? 'text-amber-700'
                                      : art.verificationStatus === 'archived'
                                      ? 'text-slate-500'
                                      : 'text-slate-600'
                                  }`}
                                >
                                  {art.verificationStatus === 'verified' && 'যাচাইকৃত'}
                                  {art.verificationStatus === 'flagged' && 'ফ্ল্যাগড'}
                                  {art.verificationStatus === 'archived' && 'আর্কাইভকৃত'}
                                  {art.verificationStatus === 'unverified' && 'অযাচাইকৃত'}
                                </span>
                              </td>

                              {/* Functional Affordance Icons Only */}
                              <td
                                className="py-3 px-4 align-top text-right whitespace-nowrap"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="inline-flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={(e) => handleToggleBookmark(art, e)}
                                    title="বুকমার্ক করুন"
                                    className={`p-1.5 rounded hover:bg-slate-200 transition-colors cursor-pointer ${
                                      art.isBookmarked
                                        ? 'text-amber-600'
                                        : 'text-slate-400 hover:text-slate-700'
                                    }`}
                                  >
                                    <Bookmark
                                      className="w-4 h-4"
                                      fill={art.isBookmarked ? 'currentColor' : 'none'}
                                    />
                                  </button>
                                  <a
                                    href={art.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    title="মূল নিউজ পোর্টালে প্রতিবেদনটি খুলুন"
                                    className="p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200 transition-colors"
                                  >
                                    <ExternalLink className="w-4 h-4" />
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedArticleId(art.id)}
                                    title="বিস্তারিত ও সম্পাদনা"
                                    className="p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200 transition-colors cursor-pointer"
                                  >
                                    <ChevronRight className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Side Investigation & Record Management Drawer */}
              {selectedArticle && (
                <aside className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-5 sticky top-20">
                  <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        <span className="font-semibold text-red-700">
                          {selectedArticle.category}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{selectedArticle.portalName}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">
                          {selectedArticle.publishedDate}
                        </span>
                      </div>
                      <h2 className="text-base font-semibold text-slate-900 leading-snug">
                        {selectedArticle.title}
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedArticleId(null)}
                      className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer shrink-0"
                      aria-label="প্যানেল বন্ধ করুন"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Summary & Metadata */}
                  <div className="space-y-3 text-xs text-slate-700">
                    <p className="leading-relaxed bg-slate-50 p-3.5 rounded-md border border-slate-200">
                      {selectedArticle.summary}
                    </p>

                    <div className="flex flex-wrap items-center gap-2 text-slate-600">
                      <span>জেলা/অঞ্চল: <strong className="text-slate-900">{selectedArticle.district}</strong></span>
                      <span aria-hidden="true">·</span>
                      <span>সনাক্তকৃত কি-ওয়ার্ড: <strong className="text-slate-900">{selectedArticle.matchedKeywords}</strong></span>
                    </div>

                    <div className="pt-1 flex items-center justify-between gap-2">
                      <a
                        href={selectedArticle.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors"
                      >
                        <span>মূল নিউজ পোর্টালে সম্পূর্ণ খবর পড়ুন</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>

                      <button
                        type="button"
                        onClick={() => handleDeleteArticle(selectedArticle)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-700 bg-red-50 rounded-md hover:bg-red-100 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>ডাটাবেজ থেকে মুছুন</span>
                      </button>
                    </div>
                  </div>

                  {/* Terminal State Notice if Archived */}
                  {selectedArticle.verificationStatus === 'archived' ? (
                    <div className="p-3.5 bg-slate-100 border border-slate-200 rounded-md flex items-center gap-2.5 text-xs text-slate-700">
                      <Lock className="w-4 h-4 text-slate-600 shrink-0" />
                      <span>
                        এই সংবাদটি <strong>আর্কাইভকৃত (Archived)</strong> অবস্থায় লক করা হয়েছে। নিরাপত্তা নিয়ম অনুযায়ী আর্কাইভকৃত রেকর্ডের তথ্য পরবর্তীতে পরিবর্তন করা যায় না।
                      </span>
                    </div>
                  ) : (
                    <>
                      {/* Action 2 Form: Verification Status & Investigation Notes */}
                      <div className="space-y-3 pt-4 border-t border-slate-200">
                        <h3 className="text-xs font-semibold text-slate-900">
                          ০১. যাচাইকরণ স্ট্যাটাস ও তদন্ত নোট হালনাগাদ
                        </h3>
                        <div className="grid grid-cols-1 gap-3">
                          <div>
                            <label className="block text-xs text-slate-600 mb-1">
                              যাচাইকরণ স্ট্যাটাস (Verification Status)
                            </label>
                            <select
                              value={editStatus}
                              onChange={(e) =>
                                setEditStatus(e.target.value as VerificationStatus)
                              }
                              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md"
                            >
                              {(
                                ['unverified', 'verified', 'flagged', 'archived'] as const
                              ).map((st) => (
                                <option key={st} value={st}>
                                  {STATUS_LABELS[st]}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs text-slate-600 mb-1">
                              গবেষক / বিশ্লেষক নোট (সর্বোচ্চ ১০০০ অক্ষর)
                            </label>
                            <textarea
                              rows={3}
                              value={editNotes}
                              onChange={(e) => setEditNotes(e.target.value)}
                              placeholder="ঘটনার সূত্র, মামলার অগ্রগতি বা অতিরিক্ত তথ্য এখানে লিখুন..."
                              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900 focus:bg-white"
                            />
                          </div>

                          <button
                            type="button"
                            disabled={isSavingArticleEdit}
                            onClick={handleSaveStatusAndNotes}
                            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>স্ট্যাটাস ও নোট ডাটাবেজে সেভ করুন</span>
                          </button>
                        </div>
                      </div>

                      {/* Action 3 Form: Category, Keywords & District Reclassification */}
                      <div className="space-y-3 pt-4 border-t border-slate-200">
                        <h3 className="text-xs font-semibold text-slate-900">
                          ০২. ক্যাটাগরি, কি-ওয়ার্ড ও জেলা পুনঃশ্রেণীবিন্যাস
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-slate-600 mb-1">
                              অপরাধ ক্যাটাগরি
                            </label>
                            <select
                              value={editCategory}
                              onChange={(e) =>
                                setEditCategory(e.target.value as CrimeCategory)
                              }
                              className="w-full px-2.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md"
                            >
                              {allCategories.map((c) => (
                                <option key={c.id} value={c.name}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs text-slate-600 mb-1">
                              জেলা / অঞ্চল
                            </label>
                            <select
                              value={editDistrict}
                              onChange={(e) => setEditDistrict(e.target.value)}
                              className="w-full px-2.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md"
                            >
                              <option value="সারাদেশ">সারাদেশ</option>
                              <option value="পার্বত্য অঞ্চল">পার্বত্য অঞ্চল</option>
                              {BANGLADESH_DISTRICTS.map((d) => (
                                <option key={d} value={d}>
                                  {d}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs text-slate-600 mb-1">
                            সম্পর্কিত কি-ওয়ার্ডসমূহ (কমা দিয়ে আলাদা করুন)
                          </label>
                          <input
                            type="text"
                            value={editKeywords}
                            onChange={(e) => setEditKeywords(e.target.value)}
                            className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md"
                          />
                        </div>

                        <button
                          type="button"
                          disabled={isSavingArticleEdit}
                          onClick={handleSaveClassification}
                          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-800 bg-slate-100 rounded-md hover:bg-slate-200 disabled:opacity-50 transition-colors cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>শ্রেণীবিন্যাস আপডেট করুন</span>
                        </button>
                      </div>
                    </>
                  )}
                </aside>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: LIVE SCRAPER CONSOLE (লাইভ পোর্টাল স্ক্র্যাপার ইঞ্জিন) */}
        {activeTab === 'scraper' && (
          <div className="space-y-6">
            <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-slate-900">
                    ০১. রিয়েল-টাইম বাংলাদেশী নিউজ পোর্টাল স্ক্র্যাপার কনসোল
                  </h2>
                  <p className="text-xs text-slate-600">
                    নির্দিষ্ট তারিখ সীমা, অপরাধ ক্যাটাগরি (কাস্টম ক্যাটাগরি সহ), কি-ওয়ার্ড এবং পোর্টাল নির্বাচন করে বাংলাদেশের সকল প্রধান সংবাদপত্র থেকে সরাসরি খবর স্ক্র্যাপ করে ডাটাবেজে জমা করুন।
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddCategoryModal(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>নতুন ক্যাটাগরি যুক্ত করুন</span>
                </button>
              </div>

              {/* Category Checkboxes */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">
                    স্ক্র্যাপিংয়ের জন্য ক্যাটাগরি নির্বাচন করুন ({scraperCategories.length}/{allCategories.length})
                  </span>
                  <div className="flex items-center gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() =>
                        setScraperCategories(allCategories.map((c) => c.name))
                      }
                      className="text-slate-700 hover:underline font-medium cursor-pointer"
                    >
                      সবগুলো নির্বাচন করুন
                    </button>
                    <button
                      type="button"
                      onClick={() => setScraperCategories([allCategories[0].name])}
                      className="text-slate-500 hover:underline cursor-pointer"
                    >
                      সংক্ষিপ্ত করুন
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                  {allCategories.map((cat) => {
                    const checked = scraperCategories.includes(cat.name);
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => {
                          setScraperCategories((prev) =>
                            prev.includes(cat.name)
                              ? prev.length > 1
                                ? prev.filter((c) => c !== cat.name)
                                : prev
                              : [...prev, cat.name]
                          );
                        }}
                        className={`p-3 rounded-md border text-left transition-colors cursor-pointer ${
                          checked
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <div className="text-xs font-semibold flex items-center justify-between gap-1">
                          <span className="truncate">{cat.name}</span>
                          {checked && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </div>
                        <div
                          className={`text-[11px] mt-1 line-clamp-1 ${
                            checked ? 'text-slate-300' : 'text-slate-500'
                          }`}
                        >
                          {(effectiveCategoryKeywordsMap[cat.name] || cat.defaultKeywords)
                            .slice(0, 4)
                            .join(' · ')}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Scraper Parameters Grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    টার্গেট নিউজ পোর্টাল
                  </label>
                  <select
                    value={scraperPortal}
                    onChange={(e) => setScraperPortal(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md"
                  >
                    <option value="all">বাংলাদেশের সকল নিউজ পোর্টাল (২২+ পোর্টাল)</option>
                    {BANGLADESH_NEWS_PORTALS.map((p) => (
                      <option key={p.id} value={p.domain}>
                        {p.name} ({p.domain})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    শুরুর তারিখ (Start Date)
                  </label>
                  <input
                    type="date"
                    value={scraperStartDate}
                    onChange={(e) => setScraperStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono-tabular bg-slate-50 border border-slate-200 rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    শেষ তারিখ (End Date)
                  </label>
                  <input
                    type="date"
                    value={scraperEndDate}
                    onChange={(e) => setScraperEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono-tabular bg-slate-50 border border-slate-200 rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    অতিরিক্ত কাস্টম কি-ওয়ার্ড (ঐচ্ছিক)
                  </label>
                  <input
                    type="text"
                    value={scraperCustomKeywords}
                    onChange={(e) => setScraperCustomKeywords(e.target.value)}
                    placeholder="যেমন: কুকি-চিন, স্বর্ণ চোরাচালান, বিকাশ প্রতারণা..."
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="text-xs text-slate-500">
                  স্ক্র্যাপকৃত সকল নতুন সংবাদ স্বয়ংক্রিয়ভাবে ডুপ্লিকেট চেক করে ডাটাবেজে সংরক্ষিত হবে।
                </div>
                <button
                  type="button"
                  disabled={isScraping}
                  onClick={async () => {
                    await executeScrape({
                      categories: scraperCategories,
                      portalDomain: scraperPortal,
                      startDate: scraperStartDate,
                      endDate: scraperEndDate,
                      customKeywords: scraperCustomKeywords,
                    });
                    if (scraperStartDate) setStartDateFilter(scraperStartDate);
                    if (scraperEndDate) setEndDateFilter(scraperEndDate);
                    setActiveTab('database');
                  }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-red-700 rounded-md hover:bg-red-800 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${isScraping ? 'animate-spin' : ''}`} />
                  <span>
                    {isScraping
                      ? 'রিয়েল-টাইম স্ক্র্যাপিং চলছে...'
                      : 'রিয়েল-টাইম স্ক্র্যাপ ও ডাটাবেজে জমা করুন'}
                  </span>
                </button>
              </div>
            </section>

            {/* Supported Bangladeshi News Portals Directory */}
            <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
              <h3 className="text-sm font-semibold text-slate-900">
                ০২. সংযুক্ত বাংলাদেশী নিউজ পোর্টালসমূহ ({BANGLADESH_NEWS_PORTALS.length}টি জাতীয় ও অনলাইন পোর্টাল)
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {BANGLADESH_NEWS_PORTALS.map((portal) => (
                  <button
                    key={portal.id}
                    type="button"
                    onClick={() => {
                      setPortalFilter(portal.domain);
                      setActiveTab('database');
                    }}
                    className="p-3 border border-slate-200 rounded-md text-left hover:border-slate-900 transition-colors cursor-pointer"
                  >
                    <div className="text-xs font-semibold text-slate-900">
                      {portal.name}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono-tabular truncate">
                      {portal.domain}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* TAB 3: CATEGORY & KEYWORD CONFIGURATION DATABASE (ক্যাটাগরি ও কি-ওয়ার্ড কনফিগারেশন) */}
        {activeTab === 'keywords' && (
          <div className="space-y-4">
            <section className="bg-white border border-slate-200 rounded-lg p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-900">
                  ০১. ক্যাটাগরি ও স্বয়ংক্রিয় সার্চ কি-ওয়ার্ড ডাটাবেজ ({allCategories.length}টি ক্যাটাগরি)
                </h2>
                <p className="text-xs text-slate-600">
                  আপনি চাইলে নতুন যেকোনো ক্যাটাগরি ও কি-ওয়ার্ড যুক্ত করতে পারবেন এবং বিদ্যমান ক্যাটাগরির কি-ওয়ার্ড পরিবর্তন করতে পারবেন। নতুন ক্যাটাগরি যুক্ত করার সাথে সাথেই অটো-স্ক্র্যাপার সেই ক্যাটাগরির সংবাদ সংগ্রহ করে ডাটাবেজে জমা করবে।
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddCategoryModal(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-red-700 rounded-md hover:bg-red-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>নতুন ক্যাটাগরি যুক্ত করুন</span>
              </button>
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {allCategories.map((catDef, idx) => {
                const currentVal =
                  editingCategoryKeywords[catDef.name] ??
                  keywordConfigs[catDef.name]?.keywordsCsv ??
                  catDef.defaultKeywords.join(', ');

                return (
                  <div
                    key={catDef.id}
                    className="bg-white border border-slate-200 rounded-lg p-5 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">
                          {String(idx + 1).padStart(2, '0')}. {catDef.name}{' '}
                          <span className="text-xs font-normal text-slate-500">
                            ({catDef.isCustom ? 'কাস্টম ক্যাটাগরি' : catDef.englishLabel})
                          </span>
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {catDef.description}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-mono-tabular text-slate-600">
                          সংবাদ: {categoryCounts[catDef.name] || 0}টি
                        </span>
                        {catDef.isCustom && (
                          <button
                            type="button"
                            onClick={() => handleDeleteCustomCategory(catDef)}
                            title="এই কাস্টম ক্যাটাগরি মুছে ফেলুন"
                            className="p-1 text-red-600 hover:bg-red-50 rounded cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        সক্রিয় কি-ওয়ার্ডসমূহ (কমা দ্বারা পৃথক করুন)
                      </label>
                      <textarea
                        rows={2}
                        value={currentVal}
                        onChange={(e) =>
                          setEditingCategoryKeywords((prev) => ({
                            ...prev,
                            [catDef.name]: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900 focus:bg-white"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCategory(catDef.name);
                          setActiveTab('database');
                        }}
                        className="text-xs font-medium text-slate-700 hover:text-slate-900 hover:underline cursor-pointer"
                      >
                        এই ক্যাটাগরির সংবাদ দেখুন ({categoryCounts[catDef.name] || 0})
                      </button>

                      <div className="flex items-center gap-2">
                        {!catDef.isCustom && (
                          <button
                            type="button"
                            onClick={() =>
                              setEditingCategoryKeywords((prev) => ({
                                ...prev,
                                [catDef.name]: catDef.defaultKeywords.join(', '),
                              }))
                            }
                            className="px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 bg-slate-100 rounded-md cursor-pointer"
                          >
                            ডিফল্ট রিসেট
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={savingKeywordCategory === catDef.name || isScraping}
                          onClick={() => handleSaveCategoryKeywords(catDef)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>
                            {savingKeywordCategory === catDef.name
                              ? 'স্ক্র্যাপ ও সেভ হচ্ছে...'
                              : 'সেভ ও নিউজ স্ক্র্যাপ করুন'}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 4: ANALYTICS & REPORT MATRIX (বিশ্লেষণ ও রিপোর্ট ডাউনলোড) */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            {/* Multi-Format Report Export Card */}
            <section className="bg-white border border-slate-200 rounded-lg p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-900">
                  পূর্ণাঙ্গ অপরাধ ও সংবাদ বিশ্লেষণ রিপোর্ট ডাউনলোড (CSV, Excel, Word, PDF)
                </h2>
                <p className="text-xs text-slate-600">
                  বর্তমান ফিল্টার অনুযায়ী ({filteredArticles.length}টি সংবাদ ও {allCategories.length}টি ক্যাটাগরি) সম্পূর্ণ রিপোর্টটি আপনার পছন্দের ফরম্যাটে ডাউনলোড করুন।
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => exportToCsv(reportExportContext)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                  <span>CSV ডাউনলোড (.csv)</span>
                </button>

                <button
                  type="button"
                  onClick={() => exportToExcel(reportExportContext)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Excel ডাউনলোড (.xlsx)</span>
                </button>

                <button
                  type="button"
                  onClick={() => exportToWord(reportExportContext)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors cursor-pointer"
                >
                  <FileText className="w-4 h-4" />
                  <span>Word ডাউনলোড (.doc)</span>
                </button>

                <button
                  type="button"
                  disabled={isExportingPdf}
                  onClick={handleDownloadPdf}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-md transition-colors cursor-pointer"
                >
                  <FileDown className="w-4 h-4" />
                  <span>{isExportingPdf ? 'PDF তৈরি হচ্ছে...' : 'PDF ডাউনলোড (.pdf)'}</span>
                </button>
              </div>
            </section>

            {/* Category Breakdown Table */}
            <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">
                  ০১. অপরাধ ও ঘটনা ক্যাটাগরি অনুযায়ী সংবাদের পরিসংখ্যানগত বিশ্লেষণ ({allCategories.length}টি ক্যাটাগরি)
                </h2>
                <span className="text-xs text-slate-500 font-mono-tabular">
                  মোট বিশ্লেষিত সংবাদ: {allArticles.length}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                      <th className="py-2.5 px-4">ক্যাটাগরি</th>
                      <th className="py-2.5 px-4">ধরন</th>
                      <th className="py-2.5 px-4">প্রধান কি-ওয়ার্ডসমূহ</th>
                      <th className="py-2.5 px-4 text-right">সংবাদের সংখ্যা</th>
                      <th className="py-2.5 px-4 text-right">শতাংশ হার</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {allCategories.map((cat) => {
                      const count = categoryCounts[cat.name] || 0;
                      const pct =
                        allArticles.length > 0
                          ? ((count / allArticles.length) * 100).toFixed(1)
                          : '0.0';
                      return (
                        <tr
                          key={cat.id}
                          onClick={() => {
                            setSelectedCategory(cat.name);
                            setActiveTab('database');
                          }}
                          className="hover:bg-slate-50 cursor-pointer"
                        >
                          <td className="py-2.5 px-4 font-semibold text-slate-900">
                            {cat.name}
                          </td>
                          <td className="py-2.5 px-4 text-slate-500">
                            {cat.isCustom ? 'কাস্টম' : 'ডিফল্ট'}
                          </td>
                          <td className="py-2.5 px-4 text-slate-500">
                            {(effectiveCategoryKeywordsMap[cat.name] || cat.defaultKeywords)
                              .slice(0, 6)
                              .join(' · ')}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono-tabular font-semibold text-slate-900">
                            {count}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono-tabular text-slate-600">
                            {pct}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Portal, District & Date Matrices */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Top News Portals */}
              <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  ০২. নিউজ পোর্টাল ভিত্তিক সংবাদের উৎস
                </h3>
                <div className="divide-y divide-slate-100 text-xs">
                  {analyticsData.topPortals.map(([portal, count]) => (
                    <div
                      key={portal}
                      className="py-2 flex items-center justify-between"
                    >
                      <span className="text-slate-700 font-medium">{portal}</span>
                      <span className="font-mono-tabular font-semibold text-slate-900">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Top Districts */}
              <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  ০৩. জেলা ও অঞ্চল ভিত্তিক ঘটনার বিস্তার
                </h3>
                <div className="divide-y divide-slate-100 text-xs">
                  {analyticsData.topDistricts.map(([dist, count]) => (
                    <div
                      key={dist}
                      onClick={() => {
                        setDistrictFilter(dist);
                        setActiveTab('database');
                      }}
                      className="py-2 flex items-center justify-between hover:bg-slate-50 cursor-pointer"
                    >
                      <span className="text-slate-700 font-medium">{dist}</span>
                      <span className="font-mono-tabular font-semibold text-slate-900">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Date Timeline */}
              <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  ০৪. তারিখ অনুযায়ী সংবাদের টাইমলাইন
                </h3>
                <div className="divide-y divide-slate-100 text-xs">
                  {analyticsData.timeline.map(([dt, count]) => (
                    <div
                      key={dt}
                      onClick={() => {
                        setStartDateFilter(dt);
                        setEndDateFilter(dt);
                        setActiveTab('database');
                      }}
                      className="py-2 flex items-center justify-between hover:bg-slate-50 cursor-pointer"
                    >
                      <span className="font-mono-tabular text-slate-700">
                        {dt}
                      </span>
                      <span className="font-mono-tabular font-semibold text-slate-900">
                        {count}টি সংবাদ
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}
      </main>

      {/* Add New Custom Category Modal */}
      {showAddCategoryModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-base font-semibold text-slate-900">
                নতুন ক্যাটাগরি ও সার্চ কি-ওয়ার্ড যুক্ত করুন
              </h2>
              <button
                type="button"
                onClick={() => setShowAddCategoryModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateNewCategory} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  নতুন ক্যাটাগরির নাম *
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={100}
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="যেমন: সড়ক দুর্ঘটনা, অগ্নিকাণ্ড, মানবপাচার, চাঁদাবাজি..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900 focus:bg-white"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  সম্পর্কিত সার্চ কি-ওয়ার্ডসমূহ (কমা দিয়ে আলাদা করুন) *
                </label>
                <textarea
                  rows={3}
                  required
                  value={newCategoryKeywords}
                  onChange={(e) => setNewCategoryKeywords(e.target.value)}
                  placeholder="যেমন: সড়ক দুর্ঘটনা, বাস চাপায় নিহত, ট্রাক সংঘর্ষ, মর্মান্তিক দুর্ঘটনা..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900 focus:bg-white"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  এই কি-ওয়ার্ডগুলো দিয়েই বাংলাদেশের সকল নিউজ পোর্টাল থেকে রিয়েল-টাইম সংবাদ স্ক্র্যাপ করে এই ক্যাটাগরিতে জমা করা হবে।
                </p>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  সংক্ষিপ্ত বিবরণ (ঐচ্ছিক)
                </label>
                <input
                  type="text"
                  value={newCategoryDescription}
                  onChange={(e) => setNewCategoryDescription(e.target.value)}
                  placeholder="এই ক্যাটাগরির সংবাদের ধরন সম্পর্কে সংক্ষিপ্ত নোট..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900 focus:bg-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddCategoryModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 cursor-pointer"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  disabled={isAddingCategory}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-red-700 rounded-md hover:bg-red-800 disabled:opacity-50 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>
                    {isAddingCategory
                      ? 'যুক্ত ও স্ক্র্যাপ হচ্ছে...'
                      : 'ক্যাটাগরি যুক্ত ও নিউজ স্ক্র্যাপ করুন'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual News Entry Modal */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-base font-semibold text-slate-900">
                ডাটাবেজে ম্যানুয়াল সংবাদ সংযোজন
              </h2>
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddManualArticle} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  সংবাদ শিরোনাম *
                </label>
                <input
                  type="text"
                  required
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  placeholder="সংবাদের মূল শিরোনাম লিখুন..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-md"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    ক্যাটাগরি *
                  </label>
                  <select
                    value={manualCategory}
                    onChange={(e) =>
                      setManualCategory(e.target.value as CrimeCategory)
                    }
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-md"
                  >
                    {allCategories.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    প্রকাশের তারিখ *
                  </label>
                  <input
                    type="date"
                    required
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    className="w-full px-3 py-2 font-mono-tabular bg-slate-50 border border-slate-200 rounded-md"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    নিউজ পোর্টাল
                  </label>
                  <select
                    value={manualPortalName}
                    onChange={(e) => setManualPortalName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-md"
                  >
                    {BANGLADESH_NEWS_PORTALS.map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    জেলা / স্থান
                  </label>
                  <select
                    value={manualDistrict}
                    onChange={(e) => setManualDistrict(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-md"
                  >
                    <option value="সারাদেশ">সারাদেশ</option>
                    <option value="পার্বত্য অঞ্চল">পার্বত্য অঞ্চল</option>
                    {BANGLADESH_DISTRICTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  কি-ওয়ার্ডসমূহ (কমা দ্বারা পৃথক)
                </label>
                <input
                  type="text"
                  value={manualKeywords}
                  onChange={(e) => setManualKeywords(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-md"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  সংবাদের মূল লিংক (URL)
                </label>
                <input
                  type="url"
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  placeholder="https://www.prothomalo.com/..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-md"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  সংক্ষিপ্ত বিবরণী
                </label>
                <textarea
                  rows={3}
                  value={manualSummary}
                  onChange={(e) => setManualSummary(e.target.value)}
                  placeholder="সংবাদের মূল অংশ সংক্ষেপে লিখুন..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-md"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 cursor-pointer"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer"
                >
                  ডাটাবেজে সংরক্ষণ করুন
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quiet Editorial Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 px-6 mt-auto">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            BD Crime & Incident News Archive — বাংলাদেশ সংবাদ পোর্টাল স্ক্র্যাপার ও ডাটাবেজ সিস্টেম
          </span>
          <span>
            {allCategories.map((c) => c.name).join(' · ')}
          </span>
        </div>
      </footer>
    </div>
  );
}
