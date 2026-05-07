import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Activity, 
  Newspaper, 
  Search, 
  Clock, 
  Brain, 
  ExternalLink,
  X,
  Star,
  Calendar as CalendarIcon,
  Filter,
  StickyNote,
  Bell,
  ChevronDown,
  ChevronUp,
  Trash2,
  Hash,
  Download,
  RefreshCw,
  FlaskConical,
  Gavel,
  Coins,
  FileText,
  Smartphone
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, parseISO, startOfDay, subDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import { DayPicker, type DateRange } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

// --- Utility ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const formatKST = (dateStr: string | null | undefined, formatStr: string) => {
  if (!dateStr) return '';
  try {
    // Explicitly parse as UTC then convert to Asia/Seoul
    const d = dayjs.utc(dateStr).tz('Asia/Seoul');
    if (!d.isValid()) return '';
    
    if (formatStr === 'HH:mm') {
      return d.format('HH:mm');
    }
    if (formatStr === 'yyyy년 MM월 dd일 (eeee)') {
      const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
      return d.format(`YYYY년 MM월 DD일 (${weekdays[d.day()]})요일`);
    }
    // Handle other standard formats
    const standardFormat = formatStr.replace('eeee', 'ddd').replace('yyyy', 'YYYY').replace('dd', 'DD');
    return d.format(standardFormat);
  } catch (e) {
    return '';
  }
};

// --- Constants ---
const MEDIA_SOURCES = [
  '히트뉴스', '더바이오', '프레스9', '메디팜스투데이', '헬스코리아뉴스', 
  '청년의사', '뉴스더보이스', '메디칼타임즈', '의학신문', '더벨바이오', 
  '라포르시안', '데일리메디', '바이오타임즈', '메디게이트뉴스', 
  '의약뉴스', '메디소비자뉴스', '약사공론', '데일리팜', '약업신문', 
  '팜뉴스', '메디파나뉴스', '팜이데일리', '바이오스펙테이터'
];

// Refined Categories for Rapid Monitoring
const CATEGORIES = [
  { id: 'all', label: '전체 피드', icon: Newspaper },
  { id: 'approval', label: '허가/승인', icon: Gavel },
  { id: 'clinical', label: '임상/R&D', icon: FlaskConical },
  { id: 'deal', label: '기술이전/계약', icon: ExternalLink },
  { id: 'earnings', label: '실적발표', icon: Coins },
  { id: 'pricing', label: '급여/약가', icon: Coins },
  { id: 'legal', label: '행정처분/특허', icon: StickyNote },
  { id: 'finance', label: 'IPO/투자', icon: Coins },
  { id: 'product', label: '제품출시', icon: Activity },
  { id: 'etc', label: '기타/일반', icon: FileText },
];

interface NewsArticle {
  id: string;
  title: string;
  link: string;
  publishedAt: string | null;
  fetchedAt: string;
  date?: string; // Fallback for old data
  source: string;
  isStarred: boolean;
  isRead: boolean;
  aiAnalyzed?: boolean;
  type: string;
  memo: string;
  content: string;
  importance: 'high' | 'mid' | 'low';
  reason?: string;
  entities?: {
    companies: string[];
    products: string[];
  };
  summary?: string;
}

// --- Clustering Logic ---
const clusterArticles = (articles: NewsArticle[]) => {
  const clusters: { [key: string]: NewsArticle[] } = {};
  const processed = new Set();
  
  // Preliminary sort descending by time
  const sorted = [...articles].sort((a, b) => {
    const timeA = new Date(a.publishedAt || a.fetchedAt).getTime();
    const timeB = new Date(b.publishedAt || b.fetchedAt).getTime();
    return timeB - timeA;
  });

  const getCleanTitle = (t: string) => 
    t.replace(/\[.*?\]/g, '')               // [출처] 제거
     .replace(/\(.*?\)/g, '')               // (내용) 제거
     .replace(/【.*?】/g, '')               // 【내용】 제거
     .replace(/[·,."':]/g, ' ')             // 특수문자 공백화
     .replace(/\s+/g, ' ')                  // 다중 공백 제거
     .trim();

  sorted.forEach((a) => {
    if (processed.has(a.id)) return;
    const cluster = [a];
    processed.add(a.id);
    
    const cleanA = getCleanTitle(a.title);
    const keywordsA = cleanA.split(' ').filter(word => word.length > 1);

    sorted.forEach((b) => {
      if (processed.has(b.id)) return;
      
      const cleanB = getCleanTitle(b.title);
      const keywordsB = cleanB.split(' ').filter(word => word.length > 1);
      
      // Keywords overlap
      const intersection = keywordsA.filter(word => keywordsB.includes(word));
      const similarity = intersection.length / Math.max(1, Math.min(keywordsA.length, keywordsB.length));

      // Significant substring match (at least 12 chars)
      const majorPartA = cleanA.length > 15 ? cleanA.slice(0, 12) : cleanA;
      const majorPartB = cleanB.length > 15 ? cleanB.slice(0, 12) : cleanB;
      const subMatch = (cleanB.includes(majorPartA) && majorPartA.length >= 8) || 
                       (cleanA.includes(majorPartB) && majorPartB.length >= 8);

      if (similarity >= 0.75 || subMatch) {
        cluster.push(b);
        processed.add(b.id);
      }
    });

    // Final cluster sort to ensure absolute latest is at index 0
    cluster.sort((c1, c2) => {
      const t1 = new Date(c1.publishedAt || c1.fetchedAt).getTime();
      const t2 = new Date(c2.publishedAt || c2.fetchedAt).getTime();
      return t2 - t1;
    });

    clusters[cluster[0].id] = cluster;
  });
  return clusters;
}

export default function App() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [viewStarredOnly, setViewStarredOnly] = useState(false);
  const [viewUnreadOnly, setViewUnreadOnly] = useState(false);
  const [groupByCategory, setGroupByCategory] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: subDays(new Date(), 7), to: new Date() });
  const [showCalendar, setShowCalendar] = useState(false);
  const [activeSources, setActiveSources] = useState<Set<string>>(new Set(MEDIA_SOURCES));
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null);
  const [inlineMemo, setInlineMemo] = useState('');
  const [isFolded, setIsFolded] = useState(false); // Simulation for Galaxy Fold state
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [visibleCount, setVisibleCount] = useState(100);

  // Notification Handler with click support
  const notify = (title: string, body: string, url?: string) => {
    if ("Notification" in window && Notification.permission === "granted") {
      const notification = new Notification(title, { body, icon: "/favicon.ico" });
      if (url) {
        notification.onclick = (e) => {
          e.preventDefault();
          window.open(url, '_blank');
          window.focus();
        };
      }
    }
  };

  // Sync News from Server
  const clearAllArticles = async () => {
    if (!confirm("모든 기사 데이터를 삭제하고 초기화하시겠습니까?")) return;
    try {
      await fetch('/api/articles/clear', { method: 'POST' });
      setArticles([]);
      alert("데이터가 초기화되었습니다.");
    } catch (e) {
      console.error(e);
    }
  };

  const syncNews = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const response = await fetch('/api/articles/sync', { method: 'POST' });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      const data = await response.json();
      if (data.data) {
        const prevCount = articles.length;
        const newArticles = data.data;
        const diff = newArticles.length - prevCount;
        
        processNewArticles(newArticles);
        setArticles(newArticles);
        
        if (diff > 0) {
          notify("수집 완료", `${diff}건의 새로운 기사가 추가되었습니다.`);
        } else {
          notify("수집 완료", "이미 최신 상태입니다.");
        }
      }
    } catch (error: any) {
      console.error("Sync Error:", error);
      alert(`수집 중 오류 발생: ${error.message || '네트워크 상태를 확인해주세요.'}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const loadFromServer = async () => {
    try {
      const resp = await fetch('/api/articles');
      const data = await resp.json();
      processNewArticles(data);
      setArticles(data);
    } catch (e) {
      console.error("Load Error", e);
    }
  };

  // Helper to process new articles for notifications
  const processNewArticles = (newArticles: NewsArticle[]) => {
    const notifiedIds = new Set(JSON.parse(localStorage.getItem('bioticker_notified_ids') || '[]'));
    const newlyAdded = newArticles.filter(a => !notifiedIds.has(a.id));
    
    if (newlyAdded.length > 0) {
      // Notify for all new articles
      newlyAdded.forEach((a, idx) => {
        // Stagger notifications slightly if there are many
        setTimeout(() => {
          notify(`📰 [${a.source}] 새 기사`, a.title, a.link);
        }, idx * 500);
      });

      // Update notified list
      const updatedNotified = Array.from(new Set([...Array.from(notifiedIds), ...newlyAdded.map(a => a.id)]));
      localStorage.setItem('bioticker_notified_ids', JSON.stringify(updatedNotified.slice(-1000))); // Keep last 1000
    }
  };

  // Initial Data Load
  useEffect(() => {
    loadFromServer();

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    
    // Detect "Folded" state by width
    const handleResize = () => setIsFolded(window.innerWidth < 1280);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-Sync Periodically
  useEffect(() => {
    const interval = setInterval(() => {
      loadFromServer();
    }, 60000); // 1분마다 서버 상태 확인
    return () => clearInterval(interval);
  }, []);

  // Filtering Logic
  const filteredArticles = useMemo(() => {
    return articles.filter(a => {
      const artDate = new Date(a.publishedAt || a.fetchedAt);
      // Relaxed date range: always show if within the selected start day to infinity
      const matchSearch = a.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          a.source.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          a.memo.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          a.entities?.companies.some(c => c.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchCategory = selectedCategory === 'all' || a.type === selectedCategory;
      const matchStarred = !viewStarredOnly || a.isStarred;
      const matchUnread = !viewUnreadOnly || !a.isRead;
      
      // Dynamic Match Source: If source is new (not in MEDIA_SOURCES), show it unless activeSources is explicitly set 
      const matchSource = activeSources.size === MEDIA_SOURCES.length 
        ? true 
        : activeSources.has(a.source) || !MEDIA_SOURCES.includes(a.source);

      const matchCompany = !selectedCompany || a.entities?.companies.includes(selectedCompany);
      return matchSearch && matchCategory && matchStarred && matchUnread && matchSource && matchCompany;
    });
  }, [articles, searchQuery, selectedCategory, viewStarredOnly, viewUnreadOnly, activeSources, selectedCompany]);

  const allCompanies = useMemo(() => {
    const cos = new Set<string>();
    articles.forEach(a => a.entities?.companies.forEach(c => cos.add(c)));
    return Array.from(cos).sort();
  }, [articles]);

  const clusteredData = useMemo(() => clusterArticles(filteredArticles), [filteredArticles]);

  const getSortTime = (a: NewsArticle) => {
    return new Date(a.publishedAt || a.fetchedAt || a.date || 0).getTime();
  };

  const groupedArticles = useMemo(() => {
    const groups: { [key: string]: string[] } = {};
    const rootIds = Object.keys(clusteredData).sort((a, b) => {
      return getSortTime(clusteredData[b][0]) - getSortTime(clusteredData[a][0]);
    });
    
    // Slice based on visibleCount
    const slicedIds = rootIds.slice(0, visibleCount);

    if (groupByCategory) {
      slicedIds.forEach(rootId => {
        const type = clusteredData[rootId][0].type || 'etc';
        const label = CATEGORIES.find(c => c.id === type)?.label || '기타 이슈';
        if (!groups[label]) groups[label] = [];
        groups[label].push(rootId);
      });
      return groups;
    }

    slicedIds.forEach(rootId => {
      const art = clusteredData[rootId][0];
      const dateKey = formatKST(art.publishedAt || art.fetchedAt || art.date, 'yyyy년 MM월 dd일 (eeee)');
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(rootId);
    });
    return groups;
  }, [clusteredData, groupByCategory, visibleCount]);

  const toggleStar = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const article = articles.find(a => a.id === id);
    if (!article) return;
    try {
      const resp = await fetch('/api/articles/star', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isStarred: !article.isStarred })
      });
      const updated = await resp.json();
      setArticles(prev => prev.map(a => a.id === id ? updated : a));
    } catch (e) {
      console.error("Star Error", e);
    }
  };

  const handleArticleAnalysis = async (id: string) => {
    const article = articles.find(a => a.id === id);
    if (!article) return;
    
    setAnalyzingIds(prev => new Set(prev).add(id));
    try {
      const response = await fetch('/api/articles/analysis', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server Error ${response.status}`);
      }
      const updated = await response.json();
      setArticles(prev => prev.map(a => a.id === id ? updated : a));
    } catch (e: any) {
      console.error("AI Analysis Error", e);
      alert(`AI 분석 중 오류가 발생했습니다: ${e.message}`);
    } finally {
      setAnalyzingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleUpdateMemo = async (id: string) => {
    const article = articles.find(a => a.id === id);
    if (!article) return;
    
    setEditingMemoId(id);
    setInlineMemo(article.memo);
  };

  const handleSaveMemo = async (id: string) => {
    try {
      const response = await fetch('/api/articles/memo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, memo: inlineMemo })
      });
      const updated = await response.json();
      setArticles(prev => prev.map(a => a.id === id ? updated : a));
      setEditingMemoId(null);
    } catch (e) {
      console.error("Memo Update Error", e);
    }
  };

  const handleNewsSelect = async (id: string, isRead: boolean) => {
    if (!isRead) {
      setArticles(prev => prev.map(a => a.id === id ? { ...a, isRead: true } : a));
    }
  };

  const exportToExcel = () => {
    const dataToExport = filteredArticles.map(a => ({
      발행시간: a.publishedAt ? dayjs(a.publishedAt).tz('Asia/Seoul').format('YYYY-MM-DD HH:mm:ss') : '확인불가',
      수집시간: dayjs(a.fetchedAt).tz('Asia/Seoul').format('YYYY-MM-DD HH:mm:ss'),
      제목: a.title,
      출처: a.source,
      카테고리: CATEGORIES.find(c => c.id === a.type)?.label || '기타',
      메모: a.memo,
      링크: a.link
    }));
    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "News");
    XLSX.writeFile(workbook, `BioTicker_Export_${format(new Date(), 'yyyyMMdd')}.xlsx`);
  };

  return (
    <div className="flex flex-col h-screen bg-[#F0F2F5] text-slate-900 font-sans overflow-hidden">
      {/* Professional Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0 z-40 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-slate-900 p-2.5 rounded-2xl shadow-xl shadow-slate-200/50">
            <Activity className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tighter text-slate-800 leading-none">BioTicker <span className="text-emerald-600">Enterprise</span></h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Real-time Intelligence Hub</p>
              <div className="h-1 w-1 rounded-full bg-slate-300" />
              <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">DB: {articles.length}건</p>
            </div>
          </div>
        </div>

        <div className="flex-1 max-w-xl mx-8 relative hidden md:block">
           <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
           <input 
             type="text" 
             placeholder="임상, 화이자, M&A 등 키워드 검색..." 
             className="w-full bg-slate-100 border-none pl-12 pr-4 py-3 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-emerald-500/10 focus:bg-white transition-all outline-none"
             value={searchQuery}
             onChange={(e) => setSearchQuery(e.target.value)}
           />
        </div>

        <div className="flex items-center gap-2">
          {/* Mobile Search Toggle */}
          <button 
            onClick={() => setShowMobileSearch(!showMobileSearch)}
            className="md:hidden p-2 text-slate-500 hover:bg-slate-100 rounded-xl transition-all"
          >
            {showMobileSearch ? <X className="w-6 h-6" /> : <Search className="w-6 h-6" />}
          </button>

          <button onClick={exportToExcel} className="p-2.5 text-slate-500 hover:bg-emerald-50 hover:text-emerald-600 rounded-2xl transition-all" title="엑셀 내보내기">
            <Download className="w-5 h-5" />
          </button>
          <div className="h-8 w-px bg-slate-200 mx-2" />
          <button 
            onClick={syncNews} 
            disabled={isSyncing}
            className={cn(
              "p-2.5 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 disabled:opacity-50",
              isSyncing && "animate-pulse"
            )}
            title="수동 수집 실행"
          >
            <RefreshCw className={cn("w-4 h-4", isSyncing && "animate-spin")} />
          </button>
        </div>
      </header>

      {/* Mobile Search Input Overlay */}
      <AnimatePresence>
        {showMobileSearch && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="md:hidden bg-white border-b border-slate-200 px-6 py-4 z-30"
          >
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                autoFocus
                type="text" 
                placeholder="검색어를 입력하세요..." 
                className="w-full bg-slate-100 border-none pl-12 pr-4 py-3 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-emerald-500/10 focus:bg-white transition-all outline-none"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex-1 flex overflow-hidden lg:flex-row flex-col relative">
        {/* Left Nav: Fixed on Desktop, Hidden/Drawer on Small */}
        <aside className="hidden lg:flex w-72 bg-white border-r border-slate-200 flex-col p-6 space-y-10 overflow-y-auto no-scrollbar shrink-0">
          <div className="space-y-6">
            <h3 className="text-[10px] uppercase font-black text-slate-400 tracking-widest leading-none flex items-center gap-2">
              <Bell className="w-3 h-3" /> MONITORING
            </h3>
            <nav className="space-y-1.5">
              <button 
                onClick={() => { setSelectedCategory('all'); setGroupByCategory(false); setViewStarredOnly(false); }} 
                className={cn(
                  "w-full flex items-center justify-between px-4 py-3.5 rounded-2xl text-sm font-bold transition-all", 
                  (selectedCategory === 'all' && !groupByCategory && !viewStarredOnly) ? "bg-slate-900 text-white shadow-xl shadow-slate-200" : "text-slate-600 hover:bg-slate-50"
                )}
              >
                <div className="flex items-center gap-3"><Clock className="w-4 h-4" /> 최신순 전체</div>
              </button>
              <button 
                onClick={() => { setGroupByCategory(true); setViewStarredOnly(false); }} 
                className={cn(
                  "w-full flex items-center justify-between px-4 py-3.5 rounded-2xl text-sm font-bold transition-all", 
                  groupByCategory ? "bg-emerald-600 text-white shadow-xl shadow-emerald-100" : "text-slate-600 hover:bg-slate-50"
                )}
              >
                <div className="flex items-center gap-3"><Activity className="w-4 h-4" /> 카테고리별 보기</div>
              </button>
              <button 
                onClick={() => { setViewStarredOnly(true); }} 
                className={cn(
                  "w-full flex items-center justify-between px-4 py-3.5 rounded-2xl text-sm font-bold transition-all", 
                  viewStarredOnly ? "bg-amber-500 text-white shadow-xl shadow-amber-100" : "text-slate-600 hover:bg-slate-50"
                )}
              >
                <div className="flex items-center gap-3"><Star className="w-4 h-4" /> 확인 대상</div>
              </button>
            </nav>
          </div>

          <div className="space-y-6">
            <h3 className="text-[10px] uppercase font-black text-slate-400 tracking-widest leading-none flex items-center gap-2">
              <Filter className="w-3 h-3" /> TOPICS
            </h3>
            <nav className="space-y-1.5 max-h-[300px] overflow-y-auto no-scrollbar">
              {CATEGORIES.slice(1).map(cat => (
                <button 
                  key={cat.id} 
                  onClick={() => setSelectedCategory(cat.id)} 
                  className={cn(
                    "w-full flex items-center justify-between px-4 py-3.5 rounded-2xl text-sm font-bold transition-all", 
                    selectedCategory === cat.id ? "bg-slate-900 text-white shadow-xl shadow-slate-200" : "text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <div className="flex items-center gap-3"><cat.icon className="w-4 h-4" /> {cat.label}</div>
                </button>
              ))}
            </nav>
          </div>

          <div className="space-y-6">
            <h3 className="text-[10px] uppercase font-black text-slate-400 tracking-widest leading-none flex items-center justify-between">
              <span className="flex items-center gap-2"><Hash className="w-3 h-3" /> COMPANIES</span>
              {selectedCompany && <button onClick={() => setSelectedCompany(null)} className="text-emerald-600 normal-case hover:underline">Clear</button>}
            </h3>
            <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto no-scrollbar">
              {allCompanies.slice(0, 50).map(co => (
                <button 
                  key={co} 
                  onClick={() => setSelectedCompany(co === selectedCompany ? null : co)}
                  className={cn(
                    "flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all",
                    selectedCompany === co ? "bg-emerald-100 text-emerald-800" : "text-slate-500 hover:bg-slate-50"
                  )}
                >
                  {co}
                </button>
              ))}
              {allCompanies.length === 0 && <p className="text-[10px] text-slate-400 italic">추출된 회사가 없습니다.</p>}
            </div>
          </div>

          <div className="space-y-4 pt-10">
             <div className="p-5 bg-emerald-50 rounded-3xl border border-emerald-100">
                <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs mb-2">
                  <Smartphone className="w-4 h-4" /> 가이드: 갤럭시 폴드6
                </div>
                <p className="text-[11px] text-emerald-600/80 font-medium leading-relaxed">
                  화면을 펼쳐서 대시보드로 활용하거나, 접어서 한 손 뉴스로 즐길 수 있도록 최적화되었습니다.
                </p>
             </div>
             <button 
               onClick={clearAllArticles}
               className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest text-rose-500 hover:bg-rose-50 transition-all border border-dashed border-rose-200 mt-4"
             >
               <Trash2 className="w-4 h-4" /> 시스템 초기화 (전체 삭제)
             </button>
          </div>
        </aside>

        {/* Center: List & Grouping */}
        <section className="flex-1 flex flex-col min-w-0 bg-[#F0F2F5] relative overflow-hidden">
          {/* Sub-Header Toolset */}
          <div className="bg-white border-b border-slate-200 px-6 py-2 flex items-center justify-between shrink-0 z-20">
             <div className="flex items-center gap-3">
               <button onClick={() => setViewUnreadOnly(!viewUnreadOnly)} className={cn("px-4 py-2 rounded-xl text-[11px] font-black tracking-tight border transition-all", viewUnreadOnly ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200")}>
                 읽지 않음
               </button>
               <button onClick={() => setViewStarredOnly(!viewStarredOnly)} className={cn("px-4 py-2 rounded-xl text-[11px] font-black tracking-tight border transition-all", viewStarredOnly ? "bg-amber-500 text-white border-amber-500" : "bg-white text-slate-500 border-slate-200")}>
                 중요 표시
               </button>
               <button onClick={() => setGroupByCategory(!groupByCategory)} className={cn("px-4 py-2 rounded-xl text-[11px] font-black tracking-tight border transition-all", groupByCategory ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-500 border-slate-200")}>
                 카테고리별
               </button>
             </div>
            <button 
              onClick={() => setShowCalendar(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-[11px] font-black text-slate-700 hover:bg-slate-50 transition-all shadow-sm"
            >
              <CalendarIcon className="w-4 h-4 text-emerald-600" />
              {dateRange?.from ? format(dateRange.from, 'MM.dd') : '전체'} - {dateRange?.to ? format(dateRange.to, 'MM.dd') : '오늘'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 lg:px-8 pt-0 pb-10 space-y-10 no-scrollbar">
            {Object.keys(groupedArticles).length === 0 ? (
              <div className="flex flex-col items-center justify-center pt-24 text-slate-400">
                <Search className="w-16 h-16 opacity-10 mb-4" />
                <p className="text-sm italic">검색이나 필터 결과가 비어 있습니다.</p>
              </div>
            ) : (
              Object.keys(groupedArticles).map(date => (
                <div key={date} className="space-y-3">
                  <div className="flex items-center gap-4 sticky top-0 bg-[#F0F2F5]/95 backdrop-blur-sm z-10 py-1.5">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] whitespace-nowrap">{date}</span>
                    <div className="h-px bg-slate-300/20 w-full" />
                  </div>

                  <div className={cn("grid gap-4", isFolded ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-2")}>
                    {groupedArticles[date].map(rootId => {
                      const cluster = clusteredData[rootId];
                      const root = cluster[0];
                      const isExpanded = expandedClusters.has(rootId);
                      
                      return (
                        <div key={rootId} className="space-y-3">
                          <motion.div 
                            layout
                            onClick={() => {
                              window.open(root.link, '_blank');
                              handleNewsSelect(root.id, root.isRead);
                            }}
                            className={cn(
                              "bg-white rounded-[2rem] p-5 lg:p-6 border-2 cursor-pointer group transition-all relative flex flex-col gap-3 shadow-sm hover:shadow-xl hover:translate-y-[-2px]",
                              root.isRead ? "bg-slate-50/50 border-slate-100/50" : "bg-white border-white hover:border-emerald-100"
                            )}
                          >
                             {/* 1. Badge Area */}
                             <div className="flex items-start justify-between">
                                <div className="flex flex-wrap gap-1.5 align-center">
                                  {cluster.length > 1 && (
                                    <span className="px-2 py-0.5 rounded-lg bg-slate-900 text-white text-[9px] font-black uppercase tracking-tight flex items-center gap-1 shadow-sm">
                                      <Newspaper className="w-2.5 h-2.5" /> {cluster.length}개 뉴스 묶음
                                    </span>
                                  )}
                                  <span className="px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 text-[9px] font-black uppercase tracking-tight">
                                    {CATEGORIES.find(c => c.id === root.type)?.label || '기타'}
                                  </span>
                                  <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-500 text-[9px] font-bold border border-slate-200/30">
                                    {root.source}
                                  </span>
                                </div>
                                <button 
                                  onClick={(e) => toggleStar(rootId, e)}
                                  className={cn("p-1.5 rounded-xl transition-all shrink-0", root.isStarred ? "text-amber-500 bg-amber-50" : "text-slate-200 hover:text-amber-500")}
                                >
                                  <Star className={cn("w-4 h-4", root.isStarred && "fill-amber-500")} />
                                </button>
                             </div>

                             {/* 2. Date Area */}
                             <div className="flex flex-col gap-1 text-[9px] text-slate-400 font-bold uppercase tracking-tight">
                                <div className="flex items-center gap-3">
                                   <div className="flex items-center gap-1">
                                     <Clock className="w-3 h-3" /> 
                                     발행: {root.publishedAt ? formatKST(root.publishedAt, 'HH:mm') : root.date ? formatKST(root.date, 'HH:mm') : '확인 불가'}
                                   </div>
                                   <div className="flex items-center gap-1">
                                     <Download className="w-3 h-3" /> 
                                     수집: {root.fetchedAt ? formatKST(root.fetchedAt, 'HH:mm') : root.date ? formatKST(root.date, 'HH:mm') : '확인 불가'}
                                   </div>
                                </div>
                                <div className="flex items-center gap-1 hover:text-emerald-600 transition-colors w-fit">
                                   <ExternalLink className="w-3 h-3" /> 원문 보기
                                </div>
                             </div>

                             {/* 3. Title */}
                             <h3 className="text-base lg:text-lg font-bold text-slate-800 leading-tight group-hover:text-emerald-700 transition-colors">
                               {root.title}
                             </h3>

                             {root.entities && root.entities.companies.length > 0 && (
                               <div className="flex flex-wrap gap-2">
                                 {root.entities.companies.map(co => (
                                   <span key={co} className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-md text-[9px] font-black border border-slate-200"># {co}</span>
                                 ))}
                               </div>
                             )}

                             {/* 4. AI Insight result */}
                             {root.aiAnalyzed && (
                               <div className="space-y-3 bg-emerald-50/50 p-5 rounded-2xl border border-emerald-100">
                                 <div className="flex items-center gap-2 mb-1">
                                    <div className="w-1.5 h-3.5 bg-emerald-500 rounded-full" />
                                    <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest">AI Intelligence Insight</p>
                                 </div>
                                 <div className="text-[11px] font-bold text-slate-700 leading-relaxed whitespace-pre-wrap">
                                   {typeof root.summary === 'string' 
                                     ? root.summary 
                                     : (typeof root.summary === 'object' && root.summary !== null)
                                       ? Object.values(root.summary).join('\n')
                                       : root.reason || "기사 핵심 분석 중..."}
                                 </div>
                               </div>
                             )}

                             {/* 5. Memo/Status Area */}
                             <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-2 mt-2">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleArticleAnalysis(root.id); }}
                                    disabled={analyzingIds.has(root.id)}
                                    className={cn(
                                      "flex items-center justify-center gap-2 py-3 rounded-2xl text-[11px] font-black transition-all border shadow-sm disabled:opacity-50",
                                      root.aiAnalyzed ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                                    )}
                                  >
                                    <Brain className={cn("w-3.5 h-3.5", root.aiAnalyzed ? "text-emerald-600" : "text-slate-400", analyzingIds.has(root.id) && "animate-pulse")} />
                                    {analyzingIds.has(root.id) ? '분석 중...' : 'AI 분석'}
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleUpdateMemo(root.id); }}
                                    className={cn(
                                      "flex items-center justify-center gap-2 py-3 rounded-2xl text-[11px] font-black transition-all border shadow-sm",
                                      root.memo ? "bg-rose-50 text-rose-700 border-rose-100" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                                    )}
                                  >
                                    <StickyNote className={cn("w-3.5 h-3.5", root.memo ? "text-rose-600" : "text-slate-400")} />
                                    메모 작성
                                  </button>
                                </div>

                                {editingMemoId === root.id ? (
                                   <div className="space-y-2" onClick={e => e.stopPropagation()}>
                                     <textarea
                                       className="w-full p-4 rounded-2xl border border-rose-200 text-xs font-medium focus:ring-4 focus:ring-rose-500/10 outline-none min-h-[80px]"
                                       value={inlineMemo}
                                       onChange={e => setInlineMemo(e.target.value)}
                                       placeholder="메모를 입력하세요..."
                                     />
                                     <div className="flex justify-end gap-2 text-[10px] font-black uppercase">
                                       <button onClick={() => setEditingMemoId(null)} className="px-4 py-2 rounded-xl text-slate-400 hover:bg-slate-100 transition-all">취소</button>
                                       <button onClick={() => handleSaveMemo(root.id)} className="px-4 py-2 rounded-xl bg-slate-900 text-white shadow-lg transition-all">저장</button>
                                     </div>
                                   </div>
                                ) : root.memo && (
                                  <div 
                                    className="bg-rose-50/30 p-4 rounded-2xl border border-rose-100/50 cursor-pointer hover:bg-rose-50 transition-colors"
                                    onClick={(e) => { e.stopPropagation(); handleUpdateMemo(root.id); }}
                                  >
                                    <p className="text-[11px] font-bold text-rose-700 leading-relaxed whitespace-pre-wrap">
                                      <span className="opacity-50 block mb-1 uppercase tracking-tighter">[MEMO]</span>
                                      {root.memo}
                                    </p>
                                  </div>
                                )}
                             </div>

                             {cluster.length > 1 && (
                                <div className="bg-slate-50/80 rounded-2xl p-4 flex flex-col gap-3 mt-1 border border-slate-200/50 shadow-inner">
                                   <div className="flex items-center justify-between">
                                     <div className="flex items-center gap-2">
                                       <div className="flex -space-x-1.5">
                                         {cluster.slice(1, 4).map((c, idx) => (
                                           <div key={idx} className="w-6 h-6 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-[7px] font-black text-slate-600 shadow-sm">{c.source[0]}</div>
                                         ))}
                                       </div>
                                       <p className="text-[10px] font-bold text-slate-500">다른 언론사 <span className="text-emerald-600 font-black">{cluster.length - 1}건</span> 더보기</p>
                                     </div>
                                     <button 
                                       onClick={(e) => { e.stopPropagation(); setExpandedClusters(prev => { const n = new Set(prev); if (n.has(rootId)) n.delete(rootId); else n.add(rootId); return n; }); }}
                                       className={cn(
                                         "text-[10px] font-black px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 shadow-sm border",
                                         isExpanded ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-100"
                                       )}
                                     >
                                       {isExpanded ? '묶음 접기' : '전체 보기'} {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                     </button>
                                   </div>
                                   
                                   {!isExpanded && (
                                     <p className="text-[11px] font-medium text-slate-400 truncate pl-3 border-l-2 border-slate-200">
                                       <span className="font-black text-slate-500 mr-2">[{cluster[1].source}]</span>
                                       {cluster[1].title}
                                     </p>
                                   )}
                                </div>
                             )}
                          </motion.div>

                          <AnimatePresence>
                             {isExpanded && (
                               <motion.div 
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="pl-6 space-y-2 overflow-hidden"
                               >
                                 {cluster.slice(1).map(c => (
                                   <div 
                                    key={c.id} 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      window.open(c.link, '_blank');
                                      handleNewsSelect(c.id, c.isRead);
                                    }}
                                    className="bg-white/40 border-l-4 border-slate-200 rounded-r-2xl p-4 flex items-center justify-between group cursor-pointer hover:border-emerald-300 hover:bg-white transition-all shadow-sm"
                                   >
                                      <p className="text-sm font-bold text-slate-600 group-hover:text-slate-900 truncate flex-1">{c.title}</p>
                                      <span className="text-[10px] font-bold text-slate-400 ml-4 bg-slate-50 px-2 py-0.5 rounded">{c.source}</span>
                                   </div>
                                 ))}
                               </motion.div>
                             )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
            
            {Object.keys(clusteredData).length > visibleCount && (
              <div className="flex justify-center pt-4 pb-12">
                <button 
                  onClick={() => setVisibleCount(prev => prev + 20)}
                  className="px-12 py-4 bg-white border-2 border-slate-200 rounded-2xl text-sm font-black text-slate-600 hover:border-emerald-500 hover:text-emerald-600 hover:bg-emerald-50 transition-all shadow-sm flex items-center gap-2 group"
                >
                  기사 더보기 <ChevronDown className="w-4 h-4 group-hover:translate-y-1 transition-transform" />
                </button>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Global Bottom Navigation (Custom Galaxy Fold 6 Design) */}
      <nav className="h-20 bg-white border-t border-slate-200 flex items-center justify-around shrink-0 pb-safe z-[60] lg:hidden">
        <button 
          onClick={() => { setSelectedCategory('all'); setGroupByCategory(false); }}
          className={cn("flex flex-col items-center gap-1.5 transition-all", (!groupByCategory && selectedCategory === 'all') ? "text-slate-900 scale-110" : "text-slate-400")}
        >
          <Newspaper className="w-6 h-6" />
          <span className="text-[9px] font-black uppercase tracking-tighter">최신순</span>
        </button>

        <button 
          onClick={() => { setGroupByCategory(true); }}
          className={cn("flex flex-col items-center gap-1.5 transition-all", groupByCategory ? "text-emerald-600 scale-110" : "text-slate-400")}
        >
          <Activity className="w-6 h-6" />
          <span className="text-[9px] font-black uppercase tracking-tighter">카테고리별</span>
        </button>

        <div className="relative -mt-10">
           <button 
            onClick={exportToExcel}
            className="bg-emerald-600 w-16 h-16 rounded-[1.8rem] flex items-center justify-center shadow-2xl shadow-emerald-200 text-white transform active:scale-90 transition-transform"
           >
              <Download className="w-7 h-7" />
           </button>
        </div>

        <button 
          onClick={() => { setViewStarredOnly(!viewStarredOnly); }}
          className={cn("flex flex-col items-center gap-1.5 transition-all", viewStarredOnly ? "text-amber-500 scale-110" : "text-slate-400")}
        >
           <Star className={cn("w-6 h-6", viewStarredOnly && "fill-amber-500")} />
           <span className="text-[9px] font-black uppercase tracking-tighter">중요 표시</span>
        </button>

        <button onClick={() => setShowCalendar(true)} className="flex flex-col items-center gap-1.5 text-slate-400">
           <CalendarIcon className="w-6 h-6" />
           <span className="text-[9px] font-black uppercase tracking-tighter">기간 필터</span>
        </button>
      </nav>

      {/* Calendar Overlay */}
      <AnimatePresence>
        {showCalendar && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-lg z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white p-6 md:p-10 rounded-[2.5rem] md:rounded-[3.5rem] shadow-2xl relative max-w-sm w-full border border-slate-100"
            >
              <button onClick={() => setShowCalendar(false)} className="absolute top-8 right-8 text-slate-300 hover:text-slate-900 transition-all"><X className="w-6 h-6" /></button>
              <div className="space-y-8">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-black text-slate-900 tracking-tight flex items-center gap-2">
                       <CalendarIcon className="w-5 h-5 text-emerald-600" /> 모니터링 기간
                    </h3>
                    <p className="text-[10px] font-bold text-slate-400 mt-1.5">선택한 날짜의 뉴스만 피드에 표시됩니다.</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button 
                    onClick={() => setDateRange({ from: startOfDay(new Date()), to: new Date() })}
                    className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[11px] font-black transition-all"
                  >
                    오늘
                  </button>
                  <button 
                    onClick={() => setDateRange({ from: subDays(new Date(), 7), to: new Date() })}
                    className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[11px] font-black transition-all"
                  >
                    최근 1주일
                  </button>
                </div>

                <div className="bg-slate-100/50 p-2 md:p-4 rounded-3xl border border-slate-100/50 flex justify-center">
                  <DayPicker mode="range" selected={dateRange} onSelect={setDateRange} locale={ko} />
                </div>
                <button className="w-full bg-slate-900 hover:bg-black text-white py-4.5 rounded-2xl text-[13px] font-black shadow-xl shadow-slate-200 transition-all" onClick={() => setShowCalendar(false)}>
                  업데이트 내용 적용
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .prose strong { color: white; border-bottom: 2px solid #34d399; }
        .prose p { margin-bottom: 1.25rem; font-size: 0.9rem; }
        .prose ul { margin: 1rem 0; padding-left: 1.2rem; list-style-type: square; }
        .prose li { margin-bottom: 0.5rem; color: #cbd5e1; }
        .rdp { --rdp-cell-size: 40px; --rdp-accent-color: #059669; --rdp-background-color: #ecfdf5; margin: 0; }
        @media (max-width: 640px) {
          .rdp { --rdp-cell-size: 38px; }
        }
        .rdp-day_selected { background-color: #059669 !important; color: white !important; border-radius: 10px; }
        .rdp-day_range_middle { background-color: #ecfdf5 !important; color: #065f46 !important; }
        .rdp-head_cell { font-weight: 800; color: #94a3b8; font-size: 11px; text-transform: uppercase; }
        .rdp-button:hover:not([disabled]):not(.rdp-day_selected) { background-color: #f1f5f9; border-radius: 10px; }
      `}</style>
    </div>
  );
}
