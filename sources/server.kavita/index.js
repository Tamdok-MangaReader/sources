"use strict";

const NAME = "Kavita";
const PAGE_SIZE = 30;
const NO_NUMBER = -100000;
const SPECIAL_VOLUME = 100000;

const FIELD = { SeriesName: 1, PublicationStatus: 2, Libraries: 19, Genres: 18, Tags: 6 };
const COMPARISON = { Equal: 0, Matches: 7, MustContains: 6 };
const SORT_FIELDS = [1, 2, 4, 6, 8];

const STATUS_MAP = ["ongoing", "hiatus", "completed", "cancelled", "completed"];

const session = { key: "", token: "", apiKey: "" };

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function serverUrl(ctx) {
  let url = trim(ctx.defaults.get("serverUrl", "http://localhost:5000"));
  if (!url) throw new Error("Set your Kavita server URL in source settings.");
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, "");
}

function credentials(ctx) {
  return {
    apiKey: trim(ctx.defaults.get("apiKey", "")),
    username: trim(ctx.defaults.get("username", "")),
    password: ctx.defaults.get("password", ""),
  };
}

async function authenticate(ctx, force = false) {
  const base = serverUrl(ctx);
  const creds = credentials(ctx);
  const cacheKey = `${base}|${creds.apiKey}|${creds.username}|${creds.password}`;
  if (!force && session.key === cacheKey && session.token && session.apiKey) return session;

  let response;
  if (creds.apiKey) {
    response = await ctx.request.fetch(
      `${base}/api/Plugin/authenticate?apiKey=${encodeURIComponent(creds.apiKey)}&pluginName=Tamdok`,
      { method: "POST", headers: { Accept: "application/json" } },
    );
  } else if (creds.username && creds.password) {
    response = await ctx.request.fetch(`${base}/api/Account/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username: creds.username, password: creds.password }),
    });
  } else {
    throw new Error(`${NAME}: set an API key (or username and password) in source settings.`);
  }
  if (response.status >= 400) {
    throw new Error(`${NAME}: authentication failed (${response.status}). Check your credentials.`);
  }
  const json = await response.json();
  const token = json?.token;
  const apiKey = creds.apiKey || json?.apiKey;
  if (!token || !apiKey) throw new Error(`${NAME}: authentication response is missing a token.`);
  session.key = cacheKey;
  session.token = token;
  session.apiKey = apiKey;
  return session;
}

async function kavita(ctx, path, init = {}) {
  const base = serverUrl(ctx);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const auth = await authenticate(ctx, attempt > 0);
    const response = await ctx.request.fetch(`${base}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.headers ?? {}),
        Authorization: `Bearer ${auth.token}`,
      },
    });
    if (response.status === 401 && attempt === 0) continue;
    if (response.status >= 400) throw new Error(`${NAME}: request failed (${response.status}) for ${path}`);
    return response;
  }
  throw new Error(`${NAME}: authentication failed.`);
}

async function kavitaJson(ctx, path, init) {
  const response = await kavita(ctx, path, init);
  return response.json();
}

function imageUrl(ctx, kind, query) {
  const base = serverUrl(ctx);
  const apiKey = session.apiKey || credentials(ctx).apiKey;
  return `${base}/api/Image/${kind}?${query}&apiKey=${encodeURIComponent(apiKey)}`;
}

function seriesEntry(ctx, series) {
  return {
    key: String(series.id),
    title: series.name || series.localizedName || series.originalName || String(series.id),
    cover: imageUrl(ctx, "series-cover", `seriesId=${series.id}`),
    url: `${serverUrl(ctx)}/library/${series.libraryId}/series/${series.id}`,
  };
}

function filterBody(statements, sortIndex, ascending) {
  return {
    id: 0,
    name: "",
    statements,
    combination: 1,
    sortOptions: { sortField: SORT_FIELDS[sortIndex] ?? 1, isAscending: ascending },
    limitTo: 0,
  };
}

async function fetchSeries(ctx, page, statements, sortIndex, ascending) {
  await authenticate(ctx);
  const body = filterBody(statements, sortIndex, ascending);
  const json = await kavitaJson(
    ctx,
    `/api/Series/all-v2?PageNumber=${Math.max(1, page)}&PageSize=${PAGE_SIZE}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const list = Array.isArray(json) ? json : [];
  return { entries: list.map((series) => seriesEntry(ctx, series)), hasNextPage: list.length >= PAGE_SIZE };
}

function statement(field, comparison, value) {
  return { field, comparison, value: String(value) };
}

function buildStatements(query, filters) {
  const statements = [];
  let sortIndex = 0;
  let ascending = true;
  if (trim(query)) statements.push(statement(FIELD.SeriesName, COMPARISON.Matches, trim(query)));
  for (const filter of filters ?? []) {
    switch (filter.type) {
      case "sort":
        sortIndex = filter.index ?? 0;
        ascending = filter.ascending !== false;
        break;
      case "select":
        if (filter.id === "library" && filter.value) {
          statements.push(statement(FIELD.Libraries, COMPARISON.Equal, filter.value));
        }
        break;
      case "multiSelect":
        if (filter.id === "status") {
          for (const value of filter.included ?? []) {
            statements.push(statement(FIELD.PublicationStatus, COMPARISON.Equal, value));
          }
        }
        break;
      default:
        break;
    }
  }
  return { statements, sortIndex, ascending };
}

function dateSeconds(...values) {
  for (const value of values) {
    if (!value || typeof value !== "string") continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms) && ms > Date.UTC(1971, 0, 1)) return Math.floor(ms / 1000);
  }
  return undefined;
}

function realNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  if (number <= NO_NUMBER || number >= SPECIAL_VOLUME) return undefined;
  return number;
}

function mapAgeRating(value) {
  const rating = Number(value);
  if (!Number.isFinite(rating)) return "safe";
  if (rating >= 12) return "nsfw";
  if (rating >= 8) return "suggestive";
  return "safe";
}

function buildChapters(detail) {
  const chapters = [];
  const seen = new Set();
  const add = (chapter, volumeNumber, volumeLabel) => {
    if (!chapter || seen.has(chapter.id)) return;
    seen.add(chapter.id);
    const chapterNumber = realNumber(chapter.minNumber ?? chapter.number);
    const hasVolumeOnly = chapterNumber === undefined && volumeNumber !== undefined;
    const title =
      chapter.titleName ||
      chapter.title ||
      (chapter.isSpecial ? chapter.range : undefined) ||
      (hasVolumeOnly ? `Volume ${volumeLabel ?? volumeNumber}` : undefined);
    chapters.push({
      key: String(chapter.id),
      title: title || undefined,
      chapterNumber: chapterNumber ?? (hasVolumeOnly ? volumeNumber : undefined),
      volumeNumber,
      dateUploaded: dateSeconds(chapter.releaseDate, chapter.created, chapter.createdUtc),
    });
  };
  for (const volume of detail?.volumes ?? []) {
    const volumeNumber = realNumber(volume.minNumber ?? volume.number);
    for (const chapter of volume.chapters ?? []) add(chapter, volumeNumber, volume.name);
  }
  for (const chapter of detail?.chapters ?? []) add(chapter, undefined);
  for (const chapter of detail?.specials ?? []) add(chapter, undefined);
  for (const chapter of detail?.storylineChapters ?? []) add(chapter, undefined);
  chapters.sort(
    (a, b) =>
      (b.volumeNumber ?? 0) - (a.volumeNumber ?? 0) ||
      (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0),
  );
  return chapters;
}

async function fetchLibraries(ctx) {
  try {
    const json = await kavitaJson(ctx, "/api/Library/libraries");
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}

/** @type {import("../../types/tamdok").TamdokSourceModule} */
const source = {
  async getListings(ctx) {
    const listings = [
      { id: "all", name: "All Series", kind: "grid" },
      { id: "recent", name: "Recently Added", kind: "grid" },
      { id: "ondeck", name: "On Deck", kind: "grid" },
    ];
    for (const library of await fetchLibraries(ctx)) {
      listings.push({ id: `library:${library.id}`, name: library.name, kind: "grid" });
    }
    return listings;
  },

  async getFilters(ctx) {
    const filters = [
      {
        type: "sort",
        id: "sort",
        title: "Sort",
        options: ["Name", "Date created", "Last chapter added", "Release year", "Average rating"],
        default: 0,
        defaultAscending: true,
      },
      {
        type: "multiSelect",
        id: "status",
        title: "Publication status",
        options: [
          { id: "0", label: "Ongoing" },
          { id: "1", label: "Hiatus" },
          { id: "2", label: "Completed" },
          { id: "3", label: "Cancelled" },
          { id: "4", label: "Ended" },
        ],
      },
    ];
    const libraries = await fetchLibraries(ctx);
    if (libraries.length > 0) {
      filters.unshift({
        type: "select",
        id: "library",
        title: "Library",
        options: [
          { id: "", label: "All libraries" },
          ...libraries.map((library) => ({ id: String(library.id), label: library.name })),
        ],
      });
    }
    return filters;
  },

  async getHome(ctx) {
    const components = [];
    try {
      const recent = await fetchSeries(ctx, 1, [], 1, false);
      if (recent.entries.length > 0) {
        components.push({
          kind: "scroller",
          title: "Recently Added",
          entries: recent.entries.slice(0, 12),
          listing: { id: "recent", name: "Recently Added" },
        });
      }
      try {
        const onDeck = await source.getMangaList({ id: "ondeck", name: "On Deck" }, 1, ctx);
        if (onDeck.entries.length > 0) {
          components.push({
            kind: "scroller",
            title: "On Deck",
            entries: onDeck.entries.slice(0, 12),
            listing: { id: "ondeck", name: "On Deck" },
          });
        }
      } catch {}
      const libraries = await fetchLibraries(ctx);
      if (libraries.length > 0) {
        components.push({
          kind: "filters",
          title: "Libraries",
          entries: [],
          filterItems: libraries.slice(0, 8).map((library) => ({
            title: library.name,
            filters: [{ type: "select", id: "library", value: String(library.id) }],
          })),
        });
      }
      components.push({
        kind: "links",
        title: NAME,
        entries: [],
        links: [
          { title: "Open Kavita", subtitle: serverUrl(ctx), url: serverUrl(ctx) },
          { title: "All series", listing: { id: "all", name: "All Series" } },
        ],
      });
    } catch (error) {
      components.push({
        kind: "links",
        title: "Setup",
        entries: [],
        links: [
          {
            title: "Configure Kavita server",
            subtitle: error instanceof Error ? error.message : "Check source settings",
            url: "https://www.kavitareader.com",
          },
        ],
      });
    }
    return { components };
  },

  async getSearchMangaList({ query, page, filters }, ctx) {
    const { statements, sortIndex, ascending } = buildStatements(query, filters);
    return fetchSeries(ctx, page ?? 1, statements, sortIndex, ascending);
  },

  async getMangaList(listing, page, ctx) {
    const id = listing?.id ?? "";
    if (id === "all") return fetchSeries(ctx, page, [], 0, true);
    if (id === "recent") return fetchSeries(ctx, page, [], 1, false);
    if (id === "ondeck") {
      await authenticate(ctx);
      const json = await kavitaJson(
        ctx,
        `/api/Series/on-deck?libraryId=0&PageNumber=${Math.max(1, page)}&PageSize=${PAGE_SIZE}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      const list = Array.isArray(json) ? json : [];
      return { entries: list.map((series) => seriesEntry(ctx, series)), hasNextPage: list.length >= PAGE_SIZE };
    }
    if (id.startsWith("library:")) {
      return fetchSeries(
        ctx,
        page,
        [statement(FIELD.Libraries, COMPARISON.Equal, id.slice("library:".length))],
        0,
        true,
      );
    }
    return { entries: [], hasNextPage: false };
  },

  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) {
    await authenticate(ctx);
    const updated = { ...manga };
    const tasks = [];
    if (needsDetails) {
      tasks.push(
        Promise.all([
          kavitaJson(ctx, `/api/Series/${manga.key}`),
          kavitaJson(ctx, `/api/Series/metadata?seriesId=${manga.key}`).catch(() => null),
        ]).then(([series, meta]) => {
          const names = (list) => (list ?? []).map((item) => item?.name ?? item?.title).filter(Boolean);
          const tags = [...names(meta?.genres), ...names(meta?.tags)];
          const writers = names(meta?.writers);
          const artists = names(meta?.coverArtists);
          Object.assign(updated, seriesEntry(ctx, series), {
            description: trim(meta?.summary) || undefined,
            authors: writers.length ? writers : undefined,
            artists: artists.length ? artists : undefined,
            tags: tags.length ? tags : undefined,
            status: STATUS_MAP[meta?.publicationStatus] ?? "unknown",
            contentRating: mapAgeRating(meta?.ageRating),
            viewer: "default",
          });
        }),
      );
    }
    if (needsChapters) {
      tasks.push(
        kavitaJson(ctx, `/api/Series/series-detail?seriesId=${manga.key}`).then((detail) => {
          updated.chapters = buildChapters(detail);
        }),
      );
    }
    await Promise.all(tasks);
    return updated;
  },

  async getPageList(manga, chapter, ctx) {
    await authenticate(ctx);
    const info = await kavitaJson(ctx, `/api/Reader/chapter-info?chapterId=${chapter.key}`);
    const total = Number(info?.pages);
    if (!Number.isFinite(total) || total <= 0) throw new Error(`${NAME}: no pages found for this chapter.`);
    let sizes = [];
    try {
      const dimensions = await kavitaJson(ctx, `/api/Reader/file-dimensions?chapterId=${chapter.key}`);
      if (Array.isArray(dimensions)) sizes = dimensions;
    } catch {}
    const byPage = new Map(sizes.map((item) => [Number(item.pageNumber), item]));
    const base = serverUrl(ctx);
    const apiKey = encodeURIComponent(session.apiKey);
    const pages = [];
    for (let index = 0; index < total; index += 1) {
      const size = byPage.get(index);
      const width = Number(size?.width);
      const height = Number(size?.height);
      pages.push({
        url: `${base}/api/Reader/image?chapterId=${chapter.key}&page=${index}&apiKey=${apiKey}&extractPf=true`,
        ...(width > 0 && height > 0 ? { width, height } : {}),
      });
    }
    return pages;
  },
};

if (typeof module !== "undefined") {
  module.exports = { source };
}
