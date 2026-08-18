"use strict";

const PAGE_SIZE = 40;

const SORT_OPTIONS = [
  { sort: "lastModified,desc", ascending: false },
  { sort: "created,desc", ascending: false },
  { sort: "name,asc", ascending: true },
  { sort: "name,desc", ascending: false },
];

const STATUS_MAP = {
  ONGOING: "ongoing",
  ENDED: "completed",
  HIATUS: "hiatus",
  ABANDONED: "cancelled",
};

const VIEWER_MAP = {
  LEFT_TO_RIGHT: "ltr",
  RIGHT_TO_LEFT: "rtl",
  VERTICAL: "vertical",
  WEBTOON: "webtoon",
};

function base64(value) {
  if (typeof globalThis.btoa === "function") return globalThis.btoa(value);
  return value;
}

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getServerUrl(ctx) {
  let url = trim(ctx.defaults.get("serverUrl", "http://localhost:25600"));
  if (!url) throw new Error("Set your Komga server URL in source settings.");
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, "");
}

function getAuthHeaders(ctx) {
  const headers = { Accept: "application/json" };
  const apiKey = trim(ctx.defaults.get("apiKey", ""));
  if (apiKey) headers["X-API-Key"] = apiKey;

  const username = trim(ctx.defaults.get("username", ""));
  const password = ctx.defaults.get("password", "");
  if (username && password) {
    headers.Authorization = `Basic ${base64(`${username}:${password}`)}`;
  }

  return headers;
}

function includeOneshots(ctx) {
  return ctx.defaults.get("includeOneshots", true) !== false;
}

function showReadBooks(ctx) {
  return ctx.defaults.get("showReadBooks", true) !== false;
}

function pageFormat(ctx) {
  return trim(ctx.defaults.get("pageFormat", "jpeg")) || "jpeg";
}

function defaultLibraryId(ctx) {
  return trim(ctx.defaults.get("defaultLibraryId", ""));
}

function parseDateSeconds(value) {
  if (!value || typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

function parseChapterNumber(value) {
  if (value == null) return undefined;
  const parsed = Number(String(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mapContentRating(ageRating) {
  if (typeof ageRating !== "number") return "safe";
  if (ageRating >= 18) return "nsfw";
  if (ageRating >= 16) return "suggestive";
  return "safe";
}

function mapSeriesStatus(status) {
  if (!status) return "unknown";
  return STATUS_MAP[String(status).toUpperCase()] ?? "unknown";
}

function mapViewer(readingDirection) {
  if (!readingDirection) return "default";
  return VIEWER_MAP[String(readingDirection).toUpperCase()] ?? "default";
}

function opIs(value) {
  return { operator: "is", value };
}

async function komgaRequest(ctx, path, init = {}) {
  const base = getServerUrl(ctx);
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = { ...getAuthHeaders(ctx), ...(init.headers ?? {}) };
  const response = await ctx.request.fetch(url, { ...init, headers });

  if (response.status === 401 || response.status === 403) {
    throw new Error("Komga authentication failed. Check your API key or username/password in source settings.");
  }

  return response;
}

async function komgaJson(ctx, path, init = {}) {
  const response = await komgaRequest(ctx, path, init);
  if (response.status >= 400) {
    throw new Error(`Komga request failed (${response.status}) for ${path}`);
  }
  return response.json();
}

function seriesCoverUrl(ctx, seriesId) {
  return `${getServerUrl(ctx)}/api/v1/series/${seriesId}/thumbnail`;
}

function bookCoverUrl(ctx, bookId) {
  return `${getServerUrl(ctx)}/api/v1/books/${bookId}/thumbnail`;
}

function pageImageUrl(ctx, bookId, pageNumber) {
  const format = pageFormat(ctx);
  const url = new URL(`${getServerUrl(ctx)}/api/v1/books/${bookId}/pages/${pageNumber}`);
  if (format !== "original") url.searchParams.set("convert", format);
  return url.toString();
}

function seriesToManga(ctx, series) {
  const metadata = series.metadata ?? {};
  const title = metadata.title || series.name || series.id;
  return {
    key: series.id,
    title,
    cover: seriesCoverUrl(ctx, series.id),
    url: series.url || `${getServerUrl(ctx)}/series/${series.id}`,
  };
}

function enrichSeriesDetails(ctx, series) {
  const metadata = series.metadata ?? {};
  const booksMeta = series.booksMetadata ?? {};
  const authors = (booksMeta.authors ?? metadata.authors ?? [])
    .map((entry) => (typeof entry === "string" ? entry : entry?.name))
    .filter(Boolean);
  const tags = [...(metadata.tags ?? []), ...(metadata.genres ?? []), ...(metadata.sharingLabels ?? [])];

  return {
    title: metadata.title || series.name,
    cover: seriesCoverUrl(ctx, series.id),
    description: metadata.summary || undefined,
    authors: authors.length ? authors : undefined,
    tags: tags.length ? tags : undefined,
    status: mapSeriesStatus(metadata.status),
    contentRating: mapContentRating(metadata.ageRating),
    viewer: mapViewer(metadata.readingDirection),
  };
}

function bookToChapter(ctx, book) {
  const metadata = book.metadata ?? {};
  const title = metadata.title || book.name || `Book ${book.number ?? ""}`.trim();
  const chapterNumber = parseChapterNumber(metadata.numberSort ?? metadata.number ?? book.number);
  const scanlators = (metadata.authors ?? [])
    .map((entry) => (typeof entry === "string" ? entry : entry?.name))
    .filter(Boolean);

  return {
    key: book.id,
    title,
    chapterNumber,
    volumeNumber: parseChapterNumber(metadata.number),
    dateUploaded: parseDateSeconds(book.fileLastModified ?? book.lastModified ?? book.created),
    scanlators: scanlators.length ? scanlators : undefined,
    language: metadata.language || undefined,
    thumbnail: bookCoverUrl(ctx, book.id),
    url: book.url || `${getServerUrl(ctx)}/book/${book.id}`,
  };
}

function buildSortParams(filters) {
  for (const filter of filters ?? []) {
    if (filter.type !== "sort" || filter.id !== "sort") continue;
    const selected = SORT_OPTIONS[filter.index ?? 0] ?? SORT_OPTIONS[0];
    const sort = selected.sort;
    if (filter.ascending === true && sort.endsWith(",desc")) {
      return ["sort", sort.replace(",desc", ",asc")];
    }
    if (filter.ascending === false && sort.endsWith(",asc")) {
      return ["sort", sort.replace(",asc", ",desc")];
    }
    return ["sort", sort];
  }
  return ["sort", "lastModified,desc"];
}

function buildSearchConditions(filters, ctx) {
  const conditions = [];

  const libraryId = defaultLibraryId(ctx);
  if (libraryId) conditions.push({ libraryId: opIs(libraryId) });

  if (!includeOneshots(ctx)) {
    conditions.push({ oneshot: opIs(false) });
  }

  for (const filter of filters ?? []) {
    switch (filter.type) {
      case "select":
        if (filter.id === "complete" && filter.value === "true") {
          conditions.push({ complete: opIs(true) });
        } else if (filter.id === "complete" && filter.value === "false") {
          conditions.push({ complete: opIs(false) });
        } else if (filter.id === "library" && filter.value) {
          conditions.push({ libraryId: opIs(filter.value) });
        }
        break;
      case "multiSelect":
        if (filter.id === "status" && filter.included?.length) {
          if (filter.included.length === 1) {
            conditions.push({ seriesStatus: opIs(filter.included[0]) });
          } else {
            conditions.push({
              anyOf: filter.included.map((status) => ({ seriesStatus: opIs(status) })),
            });
          }
        }
        break;
      case "check":
        if (filter.id === "oneshot" && filter.value) {
          conditions.push({ oneshot: opIs(true) });
        }
        break;
      case "text": {
        const value = trim(filter.value);
        if (!value) break;
        if (filter.id === "genre") conditions.push({ genre: opIs(value) });
        if (filter.id === "tag") conditions.push({ tag: opIs(value) });
        if (filter.id === "author") conditions.push({ author: opIs(value) });
        if (filter.id === "publisher") conditions.push({ publisher: opIs(value) });
        if (filter.id === "language") conditions.push({ language: opIs(value) });
        break;
      }
      default:
        break;
    }
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return { allOf: conditions };
}

function buildSeriesSearchBody(query, filters, ctx) {
  const body = {};
  const trimmedQuery = trim(query);
  if (trimmedQuery) body.fullTextSearch = trimmedQuery;

  const condition = buildSearchConditions(filters, ctx);
  if (condition) body.condition = condition;

  return body;
}

async function fetchSeriesPage(ctx, path, page, filters, query) {
  const apiPage = Math.max(0, page - 1);
  const [sortKey, sortValue] = buildSortParams(filters);
  const params = new URLSearchParams({
    page: String(apiPage),
    size: String(PAGE_SIZE),
  });
  params.append(sortKey, sortValue);

  const payload = buildSeriesSearchBody(query, filters, ctx);
  const data = await komgaJson(ctx, `/api/v1/series/list?${params.toString()}`, {
    method: "POST",
    headers: { ...getAuthHeaders(ctx), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const entries = (data.content ?? []).map((series) => seriesToManga(ctx, series));
  return {
    entries,
    hasNextPage: data.last === false,
  };
}

async function fetchLibraries(ctx) {
  const data = await komgaJson(ctx, "/api/v1/libraries");
  return Array.isArray(data) ? data : data.content ?? [];
}

async function fetchCollections(ctx) {
  try {
    const data = await komgaJson(ctx, "/api/v1/collections?unpaged=true");
    return Array.isArray(data) ? data : data.content ?? [];
  } catch {
    return [];
  }
}

async function fetchBooksForSeries(ctx, seriesId) {
  const params = new URLSearchParams({ unpaged: "true", sort: "metadata.numberSort,asc" });
  const readStatus = showReadBooks(ctx) ? undefined : ["UNREAD", "IN_PROGRESS"];
  if (readStatus) {
    for (const status of readStatus) params.append("read_status", status);
  }

  const data = await komgaJson(ctx, `/api/v1/series/${seriesId}/books?${params.toString()}`);
  return Array.isArray(data) ? data : data.content ?? [];
}

async function fetchOnDeckBooks(ctx, size = 12) {
  const params = new URLSearchParams({ page: "0", size: String(size) });
  const libraryId = defaultLibraryId(ctx);
  if (libraryId) params.append("library_id", libraryId);

  const data = await komgaJson(ctx, `/api/v1/books/ondeck?${params.toString()}`);
  return data.content ?? [];
}

async function fetchSeriesByEndpoint(ctx, endpoint, page) {
  const apiPage = Math.max(0, page - 1);
  const params = new URLSearchParams({ page: String(apiPage), size: String(PAGE_SIZE) });
  const libraryId = defaultLibraryId(ctx);
  if (libraryId) params.append("library_id", libraryId);
  if (!includeOneshots(ctx)) params.append("oneshot", "false");

  const data = await komgaJson(ctx, `${endpoint}?${params.toString()}`);
  return {
    entries: (data.content ?? []).map((series) => seriesToManga(ctx, series)),
    hasNextPage: data.last === false,
  };
}

const source = {
  async getListings(ctx) {
    const listings = [
      { id: "latest", name: "Latest", kind: "grid" },
      { id: "updated", name: "Recently Updated", kind: "grid" },
      { id: "new", name: "New Series", kind: "grid" },
      { id: "all", name: "All Series", kind: "grid" },
      { id: "ondeck", name: "On Deck", kind: "list" },
    ];

    try {
      const libraries = await fetchLibraries(ctx);
      for (const library of libraries) {
        listings.push({
          id: `library:${library.id}`,
          name: library.name,
          kind: "grid",
        });
      }

      const collections = await fetchCollections(ctx);
      for (const collection of collections) {
        listings.push({
          id: `collection:${collection.id}`,
          name: collection.name,
          kind: "grid",
        });
      }
    } catch {
      // Server settings may be incomplete during first setup.
    }

    return listings;
  },

  async getFilters(ctx) {
    const filters = [
      {
        type: "sort",
        id: "sort",
        title: "Sort",
        options: ["Recently Updated", "Recently Added", "Name A-Z", "Name Z-A"],
        default: 0,
        defaultAscending: false,
      },
      {
        type: "multiSelect",
        id: "status",
        title: "Status",
        options: [
          { id: "ONGOING", label: "Ongoing" },
          { id: "ENDED", label: "Ended" },
          { id: "HIATUS", label: "Hiatus" },
          { id: "ABANDONED", label: "Abandoned" },
        ],
      },
      {
        type: "select",
        id: "complete",
        title: "Completion",
        options: [
          { id: "", label: "Any" },
          { id: "true", label: "Complete" },
          { id: "false", label: "Incomplete" },
        ],
      },
      {
        type: "check",
        id: "oneshot",
        title: "One-shots only",
        default: false,
      },
      { type: "text", id: "genre", title: "Genre" },
      { type: "text", id: "tag", title: "Tag" },
      { type: "text", id: "author", title: "Author" },
      { type: "text", id: "publisher", title: "Publisher" },
      { type: "text", id: "language", title: "Language" },
    ];

    try {
      const libraries = await fetchLibraries(ctx);
      if (libraries.length > 0) {
        filters.unshift({
          type: "select",
          id: "library",
          title: "Library",
          options: [{ id: "", label: "All libraries" }, ...libraries.map((library) => ({ id: library.id, label: library.name }))],
        });
      }
    } catch {
      // Ignore when server is unreachable.
    }

    return filters;
  },

  async getHome(ctx) {
    const components = [];

    try {
      const onDeck = await fetchOnDeckBooks(ctx, 12);
      if (onDeck.length > 0) {
        components.push({
          kind: "mangaChapterList",
          title: "Continue Reading",
          entries: [],
          chapterEntries: onDeck.map((book) => ({
            manga: {
              key: book.seriesId,
              title: book.seriesTitle || book.metadata?.title || book.name,
              cover: seriesCoverUrl(ctx, book.seriesId),
            },
            chapter: bookToChapter(ctx, book),
          })),
          listing: { id: "ondeck", name: "On Deck" },
        });
      }

      const latest = await fetchSeriesByEndpoint(ctx, "/api/v1/series/latest", 1);
      if (latest.entries.length > 0) {
        components.push({
          kind: "scroller",
          title: "Recently Added",
          entries: latest.entries.slice(0, 12),
          listing: { id: "latest", name: "Latest" },
        });
      }

      const updated = await fetchSeriesByEndpoint(ctx, "/api/v1/series/updated", 1);
      if (updated.entries.length > 0) {
        components.push({
          kind: "mangaChapterList",
          title: "Recently Updated",
          entries: [],
          chapterEntries: updated.entries.slice(0, 12).map((entry) => ({
            manga: entry,
            chapter: { key: "latest", title: "Updated" },
          })),
          listing: { id: "updated", name: "Recently Updated" },
        });
      }

      const libraries = await fetchLibraries(ctx);
      if (libraries.length > 0) {
        components.push({
          kind: "filters",
          title: "Libraries",
          entries: [],
          filterItems: libraries.slice(0, 8).map((library) => ({
            title: library.name,
            filters: [{ type: "select", id: "library", value: library.id }],
          })),
        });
      }

      components.push({
        kind: "links",
        title: "Komga",
        entries: [],
        links: [
          {
            title: "Open Komga",
            subtitle: getServerUrl(ctx),
            url: getServerUrl(ctx),
          },
          {
            title: "All series",
            listing: { id: "all", name: "All Series" },
          },
        ],
      });
    } catch (error) {
      components.push({
        kind: "links",
        title: "Setup",
        entries: [],
        links: [
          {
            title: "Configure Komga server",
            subtitle: error instanceof Error ? error.message : "Check source settings",
            url: "https://komga.org/docs",
          },
        ],
      });
    }

    return { components };
  },

  async getSearchMangaList({ query, page, filters }, ctx) {
    return fetchSeriesPage(ctx, "/api/v1/series/list", page, filters, query);
  },

  async getMangaList(listing, page, ctx) {
    if (listing.id === "latest") {
      return fetchSeriesByEndpoint(ctx, "/api/v1/series/latest", page);
    }
    if (listing.id === "updated") {
      return fetchSeriesByEndpoint(ctx, "/api/v1/series/updated", page);
    }
    if (listing.id === "new") {
      return fetchSeriesByEndpoint(ctx, "/api/v1/series/new", page);
    }
    if (listing.id === "all") {
      return fetchSeriesPage(ctx, "/api/v1/series/list", page, [], "");
    }
    if (listing.id === "ondeck") {
      const books = await fetchOnDeckBooks(ctx, PAGE_SIZE);
      const seen = new Set();
      const entries = [];
      for (const book of books) {
        if (!book.seriesId || seen.has(book.seriesId)) continue;
        seen.add(book.seriesId);
        entries.push({
          key: book.seriesId,
          title: book.seriesTitle || book.name,
          cover: seriesCoverUrl(ctx, book.seriesId),
        });
      }
      return { entries, hasNextPage: false };
    }
    if (listing.id.startsWith("library:")) {
      const libraryId = listing.id.slice("library:".length);
      return fetchSeriesPage(ctx, "/api/v1/series/list", page, [{ type: "select", id: "library", value: libraryId }], "");
    }
    if (listing.id.startsWith("collection:")) {
      const collectionId = listing.id.slice("collection:".length);
      const apiPage = Math.max(0, page - 1);
      const params = new URLSearchParams({ page: String(apiPage), size: String(PAGE_SIZE) });
      const data = await komgaJson(ctx, `/api/v1/collections/${collectionId}/series?${params.toString()}`);
      return {
        entries: (data.content ?? []).map((series) => seriesToManga(ctx, series)),
        hasNextPage: data.last === false,
      };
    }

    return { entries: [], hasNextPage: false };
  },

  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) {
    const data = await komgaJson(ctx, `/api/v1/series/${manga.key}`);
    const updated = {
      ...manga,
      ...seriesToManga(ctx, data),
    };

    if (needsDetails) {
      Object.assign(updated, enrichSeriesDetails(ctx, data));
    }

    if (needsChapters) {
      const books = await fetchBooksForSeries(ctx, manga.key);
      updated.chapters = books.map((book) => bookToChapter(ctx, book));
    }

    return updated;
  },

  async getPageList(_manga, chapter, ctx) {
    const pages = await komgaJson(ctx, `/api/v1/books/${chapter.key}/pages`);
    if (!Array.isArray(pages) || pages.length === 0) {
      throw new Error("No pages found for this book.");
    }

    return pages.map((page) => ({
      url: pageImageUrl(ctx, chapter.key, page.number),
      thumbnail: `${getServerUrl(ctx)}/api/v1/books/${chapter.key}/pages/${page.number}/thumbnail`,
      ...(Number(page.width) > 0 ? { width: Number(page.width) } : {}),
      ...(Number(page.height) > 0 ? { height: Number(page.height) } : {}),
    }));
  },
};

if (typeof module !== "undefined") {
  module.exports = { source };
}
