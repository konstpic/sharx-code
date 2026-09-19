export type RoutingSuggestion = {
  value: string;
  en?: string;
  ru?: string;
  /** Selecting inserts the text into the input (to be completed) instead of adding a value. */
  prefix?: boolean;
};

export const DOMAIN_SUGGESTIONS: RoutingSuggestion[] = [
  { value: "geosite:category-ads-all", en: "Ads and trackers", ru: "Реклама и трекеры" },
  { value: "geosite:private", en: "Local / private domains", ru: "Локальные домены" },
  { value: "geosite:category-ru", en: "Russian sites", ru: "Российские сайты" },
  { value: "geosite:cn", en: "China sites", ru: "Сайты Китая" },
  { value: "geosite:geolocation-!cn", en: "Non-China sites", ru: "Сайты вне Китая" },
  { value: "geosite:google", en: "Google", ru: "Google" },
  { value: "geosite:youtube", en: "YouTube", ru: "YouTube" },
  { value: "geosite:telegram", en: "Telegram", ru: "Telegram" },
  { value: "geosite:openai", en: "OpenAI / ChatGPT", ru: "OpenAI / ChatGPT" },
  { value: "geosite:netflix", en: "Netflix", ru: "Netflix" },
  { value: "geosite:apple", en: "Apple", ru: "Apple" },
  { value: "geosite:microsoft", en: "Microsoft", ru: "Microsoft" },
  { value: "geosite:github", en: "GitHub", ru: "GitHub" },
  { value: "geosite:facebook", en: "Facebook / Meta", ru: "Facebook / Meta" },
  { value: "geosite:tiktok", en: "TikTok", ru: "TikTok" },
  { value: "geosite:spotify", en: "Spotify", ru: "Spotify" },
  { value: "domain:", en: "domain: — domain and its subdomains", ru: "domain: — домен и поддомены", prefix: true },
  { value: "full:", en: "full: — exact domain only", ru: "full: — только точный домен", prefix: true },
  { value: "keyword:", en: "keyword: — contains text", ru: "keyword: — содержит текст", prefix: true },
  { value: "regexp:", en: "regexp: — regular expression", ru: "regexp: — регулярное выражение", prefix: true },
  { value: "ext:", en: "ext:file.dat:tag — custom geo file", ru: "ext:file.dat:tag — свой geo-файл", prefix: true },
];

export const IP_SUGGESTIONS: RoutingSuggestion[] = [
  { value: "geoip:private", en: "Private networks (LAN)", ru: "Локальные сети" },
  { value: "geoip:ru", en: "Russia", ru: "Россия" },
  { value: "geoip:cn", en: "China", ru: "Китай" },
  { value: "geoip:ir", en: "Iran", ru: "Иран" },
  { value: "geoip:us", en: "United States", ru: "США" },
  { value: "geoip:telegram", en: "Telegram", ru: "Telegram" },
  { value: "geoip:cloudflare", en: "Cloudflare", ru: "Cloudflare" },
  { value: "geoip:google", en: "Google", ru: "Google" },
  { value: "geoip:netflix", en: "Netflix", ru: "Netflix" },
  { value: "geoip:facebook", en: "Facebook / Meta", ru: "Facebook / Meta" },
  { value: "geoip:", en: "geoip: — any country code", ru: "geoip: — любой код страны", prefix: true },
  { value: "ext:", en: "ext:file.dat:tag — custom geo file", ru: "ext:file.dat:tag — свой geo-файл", prefix: true },
];

export const PROTOCOL_OPTIONS = ["http", "tls", "quic", "bittorrent"] as const;

export const NETWORK_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Any" },
  { value: "tcp", label: "TCP" },
  { value: "udp", label: "UDP" },
  { value: "tcp,udp", label: "TCP + UDP" },
];

export const BUILTIN_OUTBOUND_TAGS = ["direct", "block", "blocked"];
