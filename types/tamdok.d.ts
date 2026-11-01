// Type definitions for Tamdok JavaScript sources.
// Keep in sync with parsers/shared/types.ts in the Tamdok app repository.
//
// Usage in a source (index.js):
//   /** @type {import("../../types/tamdok").TamdokSourceModule} */
//   const source = { ... };

import type { HTMLElement } from "node-html-parser";

/**
 * A union of known values that also accepts any string. JavaScript sources build objects
 * through helpers, where literals widen to `string`; the app validates the values at runtime.
 */
type Known<T extends string> = T | (string & {});

export type MangaStatus = "unknown" | "ongoing" | "completed" | "hiatus" | "cancelled";

export type ContentRating = "safe" | "suggestive" | "nsfw";

export type Viewer = "default" | "rtl" | "ltr" | "webtoon" | "vertical";

/**
 * A title. `key` is the source-specific identifier (unique within one source).
 * Lists usually return a partial Manga (key, title, cover); details and chapters
 * are filled in later through `getMangaUpdate`.
 */
export type Manga = {
  key: string;
  title: string;
  altTitles?: string[];
  cover?: string;
  authors?: string[];
  artists?: string[];
  description?: string;
  url?: string;
  tags?: string[];
  status?: Known<MangaStatus>;
  contentRating?: Known<ContentRating>;
  rating?: string;
  viewer?: Known<Viewer>;
  chapters?: Chapter[];
  sourceId?: string;
};

/**
 * A chapter. `key` is the source-specific id. Numbers and dates are optional because
 * many sources do not provide them. `dateUploaded` is a Unix timestamp in seconds.
 */
export type Chapter = {
  key: string;
  title?: string;
  chapterNumber?: number;
  volumeNumber?: number;
  dateUploaded?: number;
  scanlators?: string[];
  url?: string;
  language?: string;
  thumbnail?: string;
  locked?: boolean;
};

/**
 * One reader page. Usually `url` (an image), but a source may also return plain `text`
 * (text chapters) or a `zipUrl` that is expanded into several images.
 */
export type Page = {
  url?: string;
  text?: string;
  thumbnail?: string;
  /** Optional pixel size from the source, used to reserve reader layout before decode. */
  width?: number;
  height?: number;
  /** CBZ/ZIP archive URL. */
  zipUrl?: string;
  /** Path inside the archive, when specified. */
  zipEntry?: string;
  /** Per-page request headers. */
  headers?: Record<string, string>;
};

export type MangaPageResult = {
  entries: Manga[];
  hasNextPage: boolean;
};

/** The user's current value for a filter. `type` matches the FilterDefinition with the same id. */
export type FilterValue =
  | { type: "sort"; id: string; index: number; ascending: boolean }
  | { type: "select"; id: string; value: string }
  | {
      type: "multiSelect";
      id: string;
      included: string[];
      excluded?: string[];
      matchAll?: boolean;
    }
  | { type: "text"; id: string; value: string }
  | { type: "check"; id: string; value: boolean }
  | { type: "range"; id: string; from?: number; to?: number }
  /** Filter values built dynamically, where `type` widens to `string`. */
  | { type: string; id: string; [key: string]: any };

/** A named, paginated list a source can serve (for example "Popular" or "Latest"). */
export type Listing = {
  id: string;
  name?: string;
  kind?: Known<"grid" | "list">;
};

export type HomeComponentKind =
  | "scroller"
  | "bigScroller"
  | "mangaGrid"
  | "mangaList"
  | "mangaChapterList"
  | "filters"
  | "links";

export type HomeLink = Manga | { type: "listing"; listing: Listing };

export type HomeFilterItem = {
  title: string;
  filters: FilterValue[];
};

export type HomeNavigationLink = {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  url?: string;
  listing?: Listing;
  manga?: Manga;
};

export type HomeChapterEntry = {
  manga: Manga;
  chapter: Chapter;
};

export type HomeScrollerEntry = {
  manga: Manga;
  /** Cover URL from the home feed; kept separate so enrichment cannot swap in banner art. */
  homeCover?: string;
  subtitle?: string;
  chapter?: Chapter;
};

export type HomeComponent = {
  title?: string;
  subtitle?: string;
  kind: Known<HomeComponentKind>;
  entries: Manga[];
  scrollerEntries?: HomeScrollerEntry[];
  chapterEntries?: HomeChapterEntry[];
  listing?: Listing;
  pageSize?: number;
  ranking?: boolean;
  /** Seconds between auto-advance slides (bigScroller). */
  autoScrollInterval?: number;
  filterItems?: HomeFilterItem[];
  links?: HomeNavigationLink[];
};

export type HomeLayout = {
  components: HomeComponent[];
};

/** Describes the filters a source supports so the UI can render them. */
export type FilterDefinition =
  | {
      type: "sort";
      id: string;
      title: string;
      options: string[];
      default?: number;
      defaultAscending?: boolean;
      hideFromHeader?: boolean;
      canAscend?: boolean;
    }
  | {
      type: "select";
      id: string;
      title: string;
      options: { id: string; label: string }[];
      default?: string;
      hideFromHeader?: boolean;
    }
  | {
      type: "multiSelect";
      id: string;
      title: string;
      options: { id: string; label: string }[];
      usesTagStyle?: boolean;
      hideFromHeader?: boolean;
      canExclude?: boolean;
    }
  | {
      type: "text";
      id: string;
      title: string;
      placeholder?: string;
      hideFromHeader?: boolean;
    }
  | {
      type: "check";
      id: string;
      title: string;
      default?: boolean;
      hideFromHeader?: boolean;
    }
  | {
      type: "range";
      id: string;
      title: string;
      min?: number;
      max?: number;
      default?: { from?: number; to?: number };
      hideFromHeader?: boolean;
    }
  /** Definitions built dynamically, where `type` widens to `string`. */
  | { type: string; id: string; title: string; [key: string]: any };

export type SourceListParams = {
  query?: string;
  page: number;
  filters?: FilterValue[];
};

/** HTTP helpers. All of them go through the app's shared fetch layer; do not call fetch() directly. */
export type TamdokRequest = {
  get: (url: string, init?: RequestInit) => Promise<TamdokResponse>;
  post: (url: string, init?: RequestInit) => Promise<TamdokResponse>;
  fetch: (url: string, init?: RequestInit) => Promise<TamdokResponse>;
  /** GET that returns the raw body (binary formats, encrypted images). Read it with `response.bytes()`. */
  getBytes: (url: string, init?: RequestInit) => Promise<TamdokResponse>;
};

export type TamdokResponse = {
  status: number;
  url: string;
  text: () => Promise<string>;
  json: <T = any>() => Promise<T>;
  /** Parsed with node-html-parser: querySelector(All), getAttribute, text, innerHTML. It is not a browser DOM. */
  html: () => HTMLElement;
  /** Raw body. Only available on responses from `request.getBytes()`; throws otherwise. */
  bytes: () => Promise<Uint8Array>;
};

/** Per-source persistent key/value storage (backs the source's settings). */
export type TamdokDefaults = {
  get: (key: string, fallback?: any) => any;
  set: <T = any>(key: string, value: T) => Promise<void>;
};

export type TamdokFiles = {
  /** Stores image bytes in the app cache and returns a file:// URI usable as a Page url. */
  saveImage: (bytes: Uint8Array, extension?: string) => Promise<string>;
};

/** Passed as the last argument to every source function. */
export type TamdokSourceContext = {
  request: TamdokRequest;
  defaults: TamdokDefaults;
  /** Cookies of the source's website (resolves to null when none are saved). */
  cookies: Promise<any>;
  sourceId: string;
  files: TamdokFiles;
};

/**
 * What a source's index.js exports as `module.exports = { source }`.
 * Every function is optional; the app only offers the capabilities a source implements.
 */
export type TamdokSourceModule = {
  getSearchMangaList?: (
    params: SourceListParams,
    ctx: TamdokSourceContext,
  ) => Promise<MangaPageResult>;
  getMangaList?: (
    listing: Listing,
    page: number,
    ctx: TamdokSourceContext,
  ) => Promise<MangaPageResult>;
  getMangaUpdate?: (
    manga: Manga,
    needsDetails: boolean,
    needsChapters: boolean,
    ctx: TamdokSourceContext,
  ) => Promise<Manga>;
  getPageList?: (manga: Manga, chapter: Chapter, ctx: TamdokSourceContext) => Promise<Page[]>;
  getHome?: (ctx: TamdokSourceContext) => Promise<HomeLayout>;
  getListings?: (ctx: TamdokSourceContext) => Promise<Listing[]>;
  getFilters?: (ctx: TamdokSourceContext) => Promise<FilterDefinition[]>;
};

/** Types for source.json. */
export type SourceInfo = {
  id: string;
  name: string;
  version: number;
  languages?: string[];
  url?: string;
  urls?: string[];
  contentRating?: number;
  minAppVersion?: string;
  maxAppVersion?: string;
};

export type TamdokSettingFieldDefinition =
  | { type: "switch"; id: string; title: string; default?: boolean; subtitle?: string }
  | {
      type: "select";
      id: string;
      title: string;
      options: { id: string; label: string }[];
      default?: string;
    }
  | {
      type: "text";
      id: string;
      title: string;
      default?: string;
      placeholder?: string;
      secure?: boolean;
    }
  | { type: "link"; id: string; title: string; url: string }
  | {
      type: "login";
      id: string;
      title: string;
      url: string;
      captureLocalStorage?: { key: string; setting: string };
    };

export type TamdokSettingDefinition =
  | { type: "section"; id: string; title: string }
  | { type: "group"; title: string; items: TamdokSettingFieldDefinition[] }
  | TamdokSettingFieldDefinition;

export type TamdokSourceManifest = {
  info: SourceInfo;
  listings?: Listing[];
  filters?: FilterDefinition[];
  settings?: TamdokSettingDefinition[];
  config?: Record<string, unknown>;
  home?: { listings?: string[] };
};
