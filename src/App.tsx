import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  Brain,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronDown,
  Clock,
  Coins,
  Download,
  ExternalLink,
  FileText,
  Filter,
  FlaskConical,
  Gavel,
  Hash,
  Newspaper,
  RefreshCw,
  Search,
  Send,
  Star,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, startOfDay, subDays } from "date-fns";
import { ko } from "date-fns/locale";
import { DayPicker, type DateRange } from "react-day-picker";
import "react-day-picker/dist/style.css";
import * as XLSX from "xlsx";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

type Importance = "high" | "mid" | "low";
type ArticleType = "approval" | "clinical" | "deal" | "earnings" | "pricing" | "legal" | "finance" | "product" | "etc";

interface NewsArticle {
  id: string;
  title: string;
  link: string;
  publishedAt: string | null;
  fetchedAt: string;
  date?: string;
  source: string;
  isStarred: boolean;
  isRead: boolean;
  aiAnalyzed: boolean;
  type: ArticleType;
  memo: string;
  content: string;
  importance: Importance;
  reason: string;
  summary: string;
  telegramSent: boolean;
  entities: {
    companies: string[];
    products: string[];
  };
}

const CATEGORIES: Array<{ id: ArticleType | "all"; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "all", label: "전체", icon: Newspaper },
  { id: "approval", label: "허가/승인", icon: Gavel },
  { id: "clinical", label: "임상/R&D", icon: FlaskConical },
  { id: "deal", label: "기술이전/계약", icon: ExternalLink },
  { id: "earnings", label: "실적", icon: Coins },
  { id: "pricing", label: "급여/약가", icon: Coins },
  { id: "legal", label: "행정/특허", icon: StickyNote },
  { id: "finance", label: "IPO/투자", icon: Coins },
  { id: "product", label: "제품 출시", icon: Activity },
  { id: "etc", label: "기타", icon: FileText },
];

const IMPORTANCE_LABELS: Record<Importance, string> = {
  high: "High",
  mid: "Mid",
  low: "Low",
};

const IMPORTANCE_STYLES: Record<Importance, string> = {
  high: "bg-rose-50 text-rose-700 border-rose-200",
  mid: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-slate-100 text-slate-600 border-slate-200",
};

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function formatKST(dateStr: string | null | undefined, formatStr = "YYYY-MM-DD HH:mm") {
  if (!dateStr) return "확인 불가";
  const parsed = dayjs.utc(dateStr).tz("Asia/Seoul");
  return parsed.isValid() ? parsed.format(formatStr) : "확인 불가";
}

function getArticleTime(article: NewsArticle) {
  return new Date(article.publishedAt || article.fetchedAt || article.date || 0).getTime();
}

function normalizeForCluster(title: string) {
  return title
    .replace(/\[[^\]]*]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[“”"'`.,:;|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clusterArticles(articles: NewsArticle[]) {
  const clusters: Record<string, NewsArticle[]> = {};
  const processed = new Set<string>();
  const sorted = [...articles].sort((a, b) => getArticleTime(b) - getArticleTime(a));

  sorted.forEach((article) => {
    if (processed.has(article.id)) return;

    const rootTitle = normalizeForCluster(article.title);
    const rootWords = rootTitle.split(" ").filter((word) => word.length > 1);
    const cluster = [article];
    processed.add(article.id);

    sorted.forEach((candidate) => {
      if (processed.has(candidate.id)) return;
      const candidateTitle = normalizeForCluster(candidate.title);
      const candidateWords = candidateTitle.split(" ").filter((word) => word.length > 1);
      const overlap = rootWords.filter((word) => candidateWords.includes(word)).length;
      const similarity = overlap / Math.max(1, Math.min(rootWords.length, candidateWords.length));
      const rootPrefix = rootTitle.slice(0, 12);
      const candidatePrefix = candidateTitle.slice(0, 12);
      const hasPrefixMatch =
        (rootPrefix.length >= 8 && candidateTitle.includes(rootPrefix)) ||
        (candidatePrefix.length >= 8 && rootTitle.includes(candidatePrefix));

      if (similarity >= 0.75 || hasPrefixMatch) {
        cluster.push(candidate);
        processed.add(candidate.id);
      }
    });

    cluster.sort((a, b) => getArticleTime(b) - getArticleTime(a));
    clusters[cluster[0].id] = cluster;
  });

  return clusters;
}

export default function App() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<ArticleType | "all">("all");
  const [viewStarredOnly, setViewStarredOnly] = useState(false);
  const [viewUnreadOnly, setViewUnreadOnly] = useState(false);
  const [groupByCategory, setGroupByCategory] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [notifyingIds, setNotifyingIds] = useState<Set<string>>(new Set());
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null);
  const [inlineMemo, setInlineMemo] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: subDays(new Date(), 7), to: new Date() });
  const [showCalendar, setShowCalendar] = useState(false);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [visibleCount, setVisibleCount] = useState(80);
  const [statusMessage, setStatusMessage] = useState("수집된 기사를 불러오는 중입니다.");

  const sourceList = useMemo(() => Array.from(new Set(articles.map((article) => article.source))).sort(), [articles]);

  const loadFromServer = async () => {
    try {
      const response = await fetch("/api/articles");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setArticles(data);
      setStatusMessage(`마지막 갱신: ${formatKST(new Date().toISOString(), "HH:mm:ss")}`);
    } catch (error) {
      console.error("Load Error:", error);
      setStatusMessage("기사 목록을 불러오지 못했습니다.");
    }
  };

  useEffect(() => {
    loadFromServer();
    const interval = window.setInterval(loadFromServer, 60000);
    return () => window.clearInterval(interval);
  }, []);

  const filteredArticles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return articles.filter((article) => {
      const articleDate = dayjs(article.publishedAt || article.fetchedAt || article.date);
      const rangeStart = dateRange?.from ? dayjs(startOfDay(dateRange.from)) : null;
      const rangeEnd = dateRange?.to ? dayjs(dateRange.to).endOf("day") : null;
      const matchDate = (!rangeStart || articleDate.isAfter(rangeStart) || articleDate.isSame(rangeStart)) && (!rangeEnd || articleDate.isBefore(rangeEnd) || articleDate.isSame(rangeEnd));

      const text = [
        article.title,
        article.source,
        article.memo,
        article.reason,
        article.summary,
        ...(article.entities?.companies || []),
        ...(article.entities?.products || []),
      ]
        .join(" ")
        .toLowerCase();

      const matchSearch = !query || text.includes(query);
      const matchCategory = selectedCategory === "all" || article.type === selectedCategory;
      const matchStarred = !viewStarredOnly || article.isStarred;
      const matchUnread = !viewUnreadOnly || !article.isRead;
      const matchSource = selectedSources.size === 0 || selectedSources.has(article.source);
      const matchCompany = !selectedCompany || article.entities?.companies.includes(selectedCompany);

      return matchDate && matchSearch && matchCategory && matchStarred && matchUnread && matchSource && matchCompany;
    });
  }, [articles, dateRange, searchQuery, selectedCategory, selectedCompany, selectedSources, viewStarredOnly, viewUnreadOnly]);

  const allCompanies = useMemo(() => {
    const companies = new Set<string>();
    articles.forEach((article) => article.entities?.companies.forEach((company) => companies.add(company)));
    return Array.from(companies).sort();
  }, [articles]);

  const clusteredData = useMemo(() => clusterArticles(filteredArticles), [filteredArticles]);

  const groupedArticles = useMemo(() => {
    const groups: Record<string, string[]> = {};
    const rootIds = Object.keys(clusteredData)
      .sort((a, b) => getArticleTime(clusteredData[b][0]) - getArticleTime(clusteredData[a][0]))
      .slice(0, visibleCount);

    rootIds.forEach((rootId) => {
      const root = clusteredData[rootId][0];
      const key = groupByCategory ? CATEGORIES.find((category) => category.id === root.type)?.label || "기타" : formatKST(root.publishedAt || root.fetchedAt || root.date, "YYYY.MM.DD ddd");
      if (!groups[key]) groups[key] = [];
      groups[key].push(rootId);
    });

    return groups;
  }, [clusteredData, groupByCategory, visibleCount]);

  const syncNews = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setStatusMessage("뉴스 수집 중입니다. 신규 기사는 텔레그램으로 자동 전송되고, AI 분석은 수동으로 실행됩니다.");

    try {
      const response = await fetch("/api/articles/sync", { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setArticles(result.data || []);
      setStatusMessage(`수집 완료: 새 기사 ${result.newCount || 0}건. 중복 알림은 자동으로 건너뜁니다.`);
    } catch (error: any) {
      console.error("Sync Error:", error);
      setStatusMessage(error.message || "뉴스 수집 중 오류가 발생했습니다.");
    } finally {
      setIsSyncing(false);
    }
  };

  const toggleStar = async (id: string, isStarred: boolean, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      const response = await fetch("/api/articles/star", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isStarred: !isStarred }),
      });
      const updated = await response.json();
      setArticles((prev) => prev.map((article) => (article.id === id ? updated : article)));
    } catch (error) {
      console.error("Star Error:", error);
    }
  };

  const markRead = async (article: NewsArticle) => {
    window.open(article.link, "_blank", "noopener,noreferrer");
    if (article.isRead) return;
    setArticles((prev) => prev.map((item) => (item.id === article.id ? { ...item, isRead: true } : item)));
    try {
      await fetch("/api/articles/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: article.id, isRead: true }),
      });
    } catch (error) {
      console.error("Read Error:", error);
    }
  };

  const analyzeArticle = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setAnalyzingIds((prev) => new Set(prev).add(id));
    setStatusMessage("OpenAI로 수동 분석 중입니다.");

    try {
      const response = await fetch("/api/articles/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const updated = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(updated.error || `HTTP ${response.status}`);
      setArticles((prev) => prev.map((article) => (article.id === id ? updated : article)));
      setStatusMessage("AI 분석이 완료되었습니다. 필요하면 텔레그램 버튼으로 다시 전송할 수 있습니다.");
    } catch (error: any) {
      console.error("AI Analysis Error:", error);
      setStatusMessage(error.message || "AI 분석 중 오류가 발생했습니다.");
    } finally {
      setAnalyzingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const notifyArticle = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setNotifyingIds((prev) => new Set(prev).add(id));
    setStatusMessage("텔레그램 알림을 전송 중입니다.");

    try {
      const response = await fetch("/api/articles/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const updated = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(updated.error || `HTTP ${response.status}`);
      setArticles((prev) => prev.map((article) => (article.id === id ? updated : article)));
      setStatusMessage("텔레그램 알림을 전송했습니다.");
    } catch (error: any) {
      console.error("Telegram Error:", error);
      setStatusMessage(error.message || "텔레그램 전송 중 오류가 발생했습니다.");
    } finally {
      setNotifyingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const editMemo = (article: NewsArticle, event: React.MouseEvent) => {
    event.stopPropagation();
    setEditingMemoId(article.id);
    setInlineMemo(article.memo || "");
  };

  const saveMemo = async (id: string) => {
    try {
      const response = await fetch("/api/articles/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, memo: inlineMemo }),
      });
      const updated = await response.json();
      setArticles((prev) => prev.map((article) => (article.id === id ? updated : article)));
      setEditingMemoId(null);
    } catch (error) {
      console.error("Memo Error:", error);
    }
  };

  const clearAllArticles = async () => {
    const confirmText = window.prompt("전체 기사 데이터를 삭제하려면 DELETE_ALL_ARTICLES를 입력하세요.");
    if (confirmText !== "DELETE_ALL_ARTICLES") return;

    try {
      const response = await fetch("/api/articles/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: confirmText }),
      });
      if (!response.ok) throw new Error("삭제 요청이 거부되었습니다.");
      setArticles([]);
      setStatusMessage("기사 데이터가 초기화되었습니다.");
    } catch (error: any) {
      setStatusMessage(error.message || "초기화 중 오류가 발생했습니다.");
    }
  };

  const toggleSource = (source: string) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  const exportToExcel = () => {
    const dataToExport = filteredArticles.map((article) => ({
      발행시간: article.publishedAt ? formatKST(article.publishedAt, "YYYY-MM-DD HH:mm:ss") : "확인 불가",
      수집시간: formatKST(article.fetchedAt, "YYYY-MM-DD HH:mm:ss"),
      제목: article.title,
      출처: article.source,
      카테고리: CATEGORIES.find((category) => category.id === article.type)?.label || "기타",
      중요도: IMPORTANCE_LABELS[article.importance],
      회사: article.entities?.companies.join(", "),
      제품: article.entities?.products.join(", "),
      요약: article.summary,
      메모: article.memo,
      링크: article.link,
    }));
    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "BioTicker");
    XLSX.writeFile(workbook, `BioTicker_Export_${format(new Date(), "yyyyMMdd")}.xlsx`);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-100 text-slate-900">
      <header className="z-40 flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3 shadow-sm lg:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-950">
            <Activity className="h-6 w-6 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-lg font-black leading-none text-slate-900">BioTicker Enterprise</h1>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Auto Telegram · Manual AI Analysis · OpenAI GPT</p>
          </div>
        </div>

        <div className="mx-6 hidden max-w-xl flex-1 md:block">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm font-semibold outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
              placeholder="회사, 제품, 임상, M&A, 키워드 검색"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden" onClick={() => setShowMobileSearch((value) => !value)} title="검색">
            {showMobileSearch ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
          </button>
          <button className="rounded-lg p-2 text-slate-500 hover:bg-emerald-50 hover:text-emerald-700" onClick={exportToExcel} title="엑셀 내보내기">
            <Download className="h-5 w-5" />
          </button>
          <button
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
            onClick={syncNews}
            disabled={isSyncing}
          >
            <RefreshCw className={cn("h-4 w-4", isSyncing && "animate-spin")} />
            <span className="hidden sm:inline">수동 수집</span>
          </button>
        </div>
      </header>

      <AnimatePresence>
        {showMobileSearch && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-b border-slate-200 bg-white px-4 py-3 md:hidden">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm font-semibold outline-none"
                placeholder="검색어 입력"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-5 lg:block">
          <div className="space-y-7">
            <section>
              <div className="mb-3 flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-slate-400">
                <Filter className="h-3.5 w-3.5" />
                Views
              </div>
              <div className="space-y-1.5">
                <button
                  className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold", selectedCategory === "all" && !groupByCategory ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-50")}
                  onClick={() => {
                    setSelectedCategory("all");
                    setGroupByCategory(false);
                  }}
                >
                  <Clock className="h-4 w-4" />
                  최신순
                </button>
                <button className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold", groupByCategory ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-50")} onClick={() => setGroupByCategory((value) => !value)}>
                  <Activity className="h-4 w-4" />
                  카테고리 그룹
                </button>
                <button className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold", viewStarredOnly ? "bg-amber-500 text-white" : "text-slate-600 hover:bg-slate-50")} onClick={() => setViewStarredOnly((value) => !value)}>
                  <Star className="h-4 w-4" />
                  중요 표시
                </button>
                <button className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold", viewUnreadOnly ? "bg-slate-700 text-white" : "text-slate-600 hover:bg-slate-50")} onClick={() => setViewUnreadOnly((value) => !value)}>
                  <CheckCircle2 className="h-4 w-4" />
                  읽지 않음
                </button>
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-slate-400">
                <Hash className="h-3.5 w-3.5" />
                Topics
              </div>
              <div className="space-y-1.5">
                {CATEGORIES.slice(1).map((category) => (
                  <button
                    key={category.id}
                    className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold", selectedCategory === category.id ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-50")}
                    onClick={() => setSelectedCategory(category.id)}
                  >
                    <category.icon className="h-4 w-4" />
                    {category.label}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between text-[11px] font-black uppercase tracking-wide text-slate-400">
                <span>Sources</span>
                {selectedSources.size > 0 && (
                  <button className="text-emerald-700" onClick={() => setSelectedSources(new Set())}>
                    전체
                  </button>
                )}
              </div>
              <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                {sourceList.map((source) => (
                  <button
                    key={source}
                    className={cn("flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-bold", selectedSources.has(source) ? "bg-emerald-50 text-emerald-800" : "text-slate-500 hover:bg-slate-50")}
                    onClick={() => toggleSource(source)}
                  >
                    {source}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between text-[11px] font-black uppercase tracking-wide text-slate-400">
                <span>Companies</span>
                {selectedCompany && (
                  <button className="text-emerald-700" onClick={() => setSelectedCompany(null)}>
                    해제
                  </button>
                )}
              </div>
              <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
                {allCompanies.length === 0 && <p className="text-xs font-semibold text-slate-400">AI 분석 후 회사명이 표시됩니다.</p>}
                {allCompanies.slice(0, 60).map((company) => (
                  <button
                    key={company}
                    className={cn("block w-full truncate rounded-lg px-3 py-2 text-left text-xs font-bold", selectedCompany === company ? "bg-emerald-50 text-emerald-800" : "text-slate-500 hover:bg-slate-50")}
                    onClick={() => setSelectedCompany(company === selectedCompany ? null : company)}
                  >
                    {company}
                  </button>
                ))}
              </div>
            </section>

            <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-rose-200 px-3 py-2.5 text-xs font-black uppercase tracking-wide text-rose-600 hover:bg-rose-50" onClick={clearAllArticles}>
              <Trash2 className="h-4 w-4" />
              데이터 초기화
            </button>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <button className={cn("rounded-lg border px-3 py-2 text-xs font-black", viewUnreadOnly ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600")} onClick={() => setViewUnreadOnly((value) => !value)}>
                읽지 않음
              </button>
              <button className={cn("rounded-lg border px-3 py-2 text-xs font-black", viewStarredOnly ? "border-amber-500 bg-amber-500 text-white" : "border-slate-200 bg-white text-slate-600")} onClick={() => setViewStarredOnly((value) => !value)}>
                중요 표시
              </button>
              <button className={cn("rounded-lg border px-3 py-2 text-xs font-black", groupByCategory ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-600")} onClick={() => setGroupByCategory((value) => !value)}>
                카테고리별
              </button>
            </div>

            <button className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm hover:bg-slate-50" onClick={() => setShowCalendar(true)}>
              <CalendarIcon className="h-4 w-4 text-emerald-600" />
              {dateRange?.from ? format(dateRange.from, "MM.dd") : "전체"} - {dateRange?.to ? format(dateRange.to, "MM.dd") : "오늘"}
            </button>
          </div>

          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500 lg:px-6">
            <span>{statusMessage}</span>
            <span>
              표시 {Object.keys(clusteredData).length}묶음 / 전체 {articles.length}건
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-5 lg:px-6">
            {Object.keys(groupedArticles).length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-slate-400">
                <Search className="mb-4 h-14 w-14 opacity-20" />
                <p className="text-sm font-semibold">조건에 맞는 기사가 없습니다.</p>
              </div>
            ) : (
              <div className="space-y-8">
                {Object.keys(groupedArticles).map((group) => (
                  <div key={group} className="space-y-3">
                    <div className="sticky top-0 z-10 flex items-center gap-4 bg-slate-100/95 py-2 backdrop-blur">
                      <span className="whitespace-nowrap text-[11px] font-black uppercase tracking-wide text-slate-400">{group}</span>
                      <div className="h-px flex-1 bg-slate-200" />
                    </div>

                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                      {groupedArticles[group].map((rootId) => {
                        const cluster = clusteredData[rootId];
                        const root = cluster[0];
                        const isExpanded = expandedClusters.has(rootId);
                        const CategoryIcon = CATEGORIES.find((category) => category.id === root.type)?.icon || FileText;

                        return (
                          <div key={rootId} className="space-y-2">
                            <motion.article
                              layout
                              className={cn("cursor-pointer rounded-lg border bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md", root.isRead ? "border-slate-100 opacity-75" : "border-white")}
                              onClick={() => markRead(root)}
                            >
                              <div className="mb-3 flex items-start justify-between gap-3">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className={cn("rounded-md border px-2 py-1 text-[10px] font-black", IMPORTANCE_STYLES[root.importance])}>{IMPORTANCE_LABELS[root.importance]}</span>
                                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">
                                    <CategoryIcon className="h-3 w-3" />
                                    {CATEGORIES.find((category) => category.id === root.type)?.label || "기타"}
                                  </span>
                                  <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">{root.source}</span>
                                  {cluster.length > 1 && <span className="rounded-md bg-slate-950 px-2 py-1 text-[10px] font-black text-white">{cluster.length}개 묶음</span>}
                                  {root.telegramSent && <span className="rounded-md bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700">전송됨</span>}
                                </div>
                                <button className={cn("rounded-md p-1.5 transition", root.isStarred ? "bg-amber-50 text-amber-500" : "text-slate-300 hover:bg-slate-50 hover:text-amber-500")} onClick={(event) => toggleStar(root.id, root.isStarred, event)} title="중요 표시">
                                  <Star className={cn("h-4 w-4", root.isStarred && "fill-amber-500")} />
                                </button>
                              </div>

                              <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-bold text-slate-400">
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="h-3.5 w-3.5" />
                                  발행 {formatKST(root.publishedAt || root.date, "MM-DD HH:mm")}
                                </span>
                                <span>수집 {formatKST(root.fetchedAt, "MM-DD HH:mm")}</span>
                                <span className="inline-flex items-center gap-1 text-emerald-700">
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  원문 보기
                                </span>
                              </div>

                              <h2 className="text-base font-black leading-snug text-slate-900 transition group-hover:text-emerald-700">{root.title}</h2>

                              {root.entities?.companies.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                  {root.entities.companies.map((company) => (
                                    <span key={company} className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">
                                      # {company}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {root.aiAnalyzed && (
                                <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 p-4">
                                  <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-emerald-800">
                                    <Brain className="h-4 w-4" />
                                    AI Intelligence Insight
                                  </div>
                                  <p className="whitespace-pre-wrap text-sm font-semibold leading-relaxed text-slate-700">{root.summary || root.reason || "분석 결과가 비어 있습니다."}</p>
                                  {root.reason && <p className="mt-3 text-xs font-bold text-emerald-800">근거: {root.reason}</p>}
                                </div>
                              )}

                              <div className="mt-4 grid grid-cols-3 gap-2">
                                <button
                                  className={cn("flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2.5 text-xs font-black transition disabled:opacity-50", root.aiAnalyzed ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}
                                  disabled={analyzingIds.has(root.id)}
                                  onClick={(event) => analyzeArticle(root.id, event)}
                                >
                                  <Brain className={cn("h-4 w-4", analyzingIds.has(root.id) && "animate-pulse")} />
                                  {analyzingIds.has(root.id) ? "분석 중" : "AI 분석"}
                                </button>
                                <button
                                  className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-2.5 text-xs font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                                  disabled={notifyingIds.has(root.id)}
                                  onClick={(event) => notifyArticle(root.id, event)}
                                >
                                  <Send className={cn("h-4 w-4", notifyingIds.has(root.id) && "animate-pulse")} />
                                  {notifyingIds.has(root.id) ? "전송 중" : root.telegramSent ? "재전송" : "텔레그램"}
                                </button>
                                <button className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-2.5 text-xs font-black text-slate-600 transition hover:bg-slate-50" onClick={(event) => editMemo(root, event)}>
                                  <StickyNote className="h-4 w-4" />
                                  메모
                                </button>
                              </div>

                              {editingMemoId === root.id && (
                                <div className="mt-3 space-y-2" onClick={(event) => event.stopPropagation()}>
                                  <textarea
                                    className="min-h-24 w-full rounded-lg border border-slate-200 p-3 text-sm font-semibold outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                                    placeholder="메모 입력"
                                    value={inlineMemo}
                                    onChange={(event) => setInlineMemo(event.target.value)}
                                  />
                                  <div className="flex justify-end gap-2">
                                    <button className="rounded-lg px-3 py-2 text-xs font-black text-slate-500 hover:bg-slate-100" onClick={() => setEditingMemoId(null)}>
                                      취소
                                    </button>
                                    <button className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white" onClick={() => saveMemo(root.id)}>
                                      저장
                                    </button>
                                  </div>
                                </div>
                              )}

                              {root.memo && editingMemoId !== root.id && (
                                <div className="mt-3 rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs font-bold leading-relaxed text-rose-700">
                                  <span className="mb-1 block text-[10px] uppercase tracking-wide text-rose-400">Memo</span>
                                  {root.memo}
                                </div>
                              )}

                              {cluster.length > 1 && (
                                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3" onClick={(event) => event.stopPropagation()}>
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="text-xs font-bold text-slate-500">다른 매체 {cluster.length - 1}건이 같은 이슈로 묶였습니다.</p>
                                    <button
                                      className="flex items-center gap-1 rounded-md bg-white px-2 py-1.5 text-[11px] font-black text-slate-600 shadow-sm"
                                      onClick={() =>
                                        setExpandedClusters((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(rootId)) next.delete(rootId);
                                          else next.add(rootId);
                                          return next;
                                        })
                                      }
                                    >
                                      {isExpanded ? "접기" : "보기"}
                                      <ChevronDown className={cn("h-3.5 w-3.5 transition", isExpanded && "rotate-180")} />
                                    </button>
                                  </div>
                                </div>
                              )}
                            </motion.article>

                            <AnimatePresence>
                              {isExpanded && (
                                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="space-y-2 overflow-hidden pl-4">
                                  {cluster.slice(1).map((article) => (
                                    <button key={article.id} className="flex w-full items-center justify-between gap-4 rounded-lg border-l-4 border-slate-300 bg-white px-4 py-3 text-left shadow-sm transition hover:border-emerald-400" onClick={() => markRead(article)}>
                                      <span className="truncate text-sm font-bold text-slate-700">{article.title}</span>
                                      <span className="shrink-0 rounded bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">{article.source}</span>
                                    </button>
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {Object.keys(clusteredData).length > visibleCount && (
                  <div className="flex justify-center pb-8 pt-2">
                    <button className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-8 py-3 text-sm font-black text-slate-600 shadow-sm hover:border-emerald-500 hover:text-emerald-700" onClick={() => setVisibleCount((count) => count + 40)}>
                      더 보기
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </main>

      <nav className="grid h-20 shrink-0 grid-cols-4 border-t border-slate-200 bg-white lg:hidden">
        <button className={cn("flex flex-col items-center justify-center gap-1 text-xs font-black", selectedCategory === "all" && !groupByCategory ? "text-slate-950" : "text-slate-400")} onClick={() => setSelectedCategory("all")}>
          <Newspaper className="h-5 w-5" />
          최신
        </button>
        <button className={cn("flex flex-col items-center justify-center gap-1 text-xs font-black", groupByCategory ? "text-emerald-700" : "text-slate-400")} onClick={() => setGroupByCategory((value) => !value)}>
          <Activity className="h-5 w-5" />
          주제
        </button>
        <button className={cn("flex flex-col items-center justify-center gap-1 text-xs font-black", viewStarredOnly ? "text-amber-500" : "text-slate-400")} onClick={() => setViewStarredOnly((value) => !value)}>
          <Star className={cn("h-5 w-5", viewStarredOnly && "fill-amber-500")} />
          중요
        </button>
        <button className="flex flex-col items-center justify-center gap-1 text-xs font-black text-slate-400" onClick={() => setShowCalendar(true)}>
          <CalendarIcon className="h-5 w-5" />
          기간
        </button>
      </nav>

      <AnimatePresence>
        {showCalendar && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} className="w-full max-w-sm rounded-xl border border-slate-100 bg-white p-5 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="flex items-center gap-2 text-base font-black text-slate-900">
                    <CalendarIcon className="h-5 w-5 text-emerald-600" />
                    모니터링 기간
                  </h3>
                  <p className="mt-1 text-xs font-semibold text-slate-400">선택한 기간의 기사만 표시합니다.</p>
                </div>
                <button className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-900" onClick={() => setShowCalendar(false)}>
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mb-4 grid grid-cols-3 gap-2">
                <button className="rounded-lg bg-slate-100 py-2 text-xs font-black text-slate-700 hover:bg-slate-200" onClick={() => setDateRange({ from: startOfDay(new Date()), to: new Date() })}>
                  오늘
                </button>
                <button className="rounded-lg bg-slate-100 py-2 text-xs font-black text-slate-700 hover:bg-slate-200" onClick={() => setDateRange({ from: subDays(new Date(), 7), to: new Date() })}>
                  7일
                </button>
                <button className="rounded-lg bg-slate-100 py-2 text-xs font-black text-slate-700 hover:bg-slate-200" onClick={() => setDateRange(undefined)}>
                  전체
                </button>
              </div>

              <div className="flex justify-center rounded-xl border border-slate-100 bg-slate-50 p-2">
                <DayPicker mode="range" selected={dateRange} onSelect={setDateRange} locale={ko} />
              </div>

              <button className="mt-4 w-full rounded-lg bg-slate-950 py-3 text-sm font-black text-white hover:bg-black" onClick={() => setShowCalendar(false)}>
                적용
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .rdp {
          --rdp-accent-color: #059669;
          --rdp-background-color: #ecfdf5;
          margin: 0;
        }
        .rdp-day_selected {
          background-color: #059669 !important;
          color: white !important;
          border-radius: 8px;
        }
        .rdp-day_range_middle {
          background-color: #ecfdf5 !important;
          color: #065f46 !important;
        }
      `}</style>
    </div>
  );
}
