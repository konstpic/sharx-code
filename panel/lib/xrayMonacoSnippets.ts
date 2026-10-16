import type { Monaco } from "@monaco-editor/react";

type SnippetDef = {
  label: string;
  detail: string;
  insertText: string;
};

const XRAY_SNIPPETS: SnippetDef[] = [
  {
    label: "vless+reality",
    detail: "VLESS inbound with REALITY",
    insertText: [
      '"protocol": "vless",',
      '"settings": { "clients": [], "decryption": "none" },',
      '"streamSettings": {',
      '  "network": "tcp",',
      '  "security": "reality",',
      '  "realitySettings": {',
      '    "show": false,',
      '    "dest": "www.apple.com:443",',
      '    "serverNames": ["www.apple.com"],',
      '    "privateKey": "",',
      '    "shortIds": [""]',
      "  }",
      "}",
    ].join("\n"),
  },
  {
    label: "vless+xhttp",
    detail: "VLESS with XHTTP transport",
    insertText: [
      '"streamSettings": {',
      '  "network": "xhttp",',
      '  "security": "tls",',
      '  "xhttpSettings": { "path": "/", "mode": "auto" }',
      "}",
    ].join("\n"),
  },
  {
    label: "vless+ws",
    detail: "VLESS WebSocket + TLS",
    insertText: [
      '"streamSettings": {',
      '  "network": "ws",',
      '  "security": "tls",',
      '  "wsSettings": { "path": "/" }',
      "}",
    ].join("\n"),
  },
  {
    label: "trojan+ws+tls",
    detail: "Trojan WebSocket TLS",
    insertText: [
      '"protocol": "trojan",',
      '"streamSettings": { "network": "ws", "security": "tls", "wsSettings": { "path": "/" } }',
    ].join("\n"),
  },
  {
    label: "hysteria2+salamander",
    detail: "Hysteria2 with salamander obfs",
    insertText: [
      '"network": "hysteria",',
      '"security": "tls",',
      '"finalmask": {',
      '  "udp": [{ "type": "salamander", "settings": { "password": "" } }]',
      "}",
    ].join("\n"),
  },
  {
    label: "outbound:masque",
    detail: "MASQUE outbound (Xray >= 26.9.30)",
    insertText: [
      "{",
      '  "tag": "masque-out",',
      '  "protocol": "masque",',
      '  "settings": { "address": "${1:masque.example.com}", "port": 443 },',
      '  "streamSettings": {',
      '    "network": "masque",',
      '    "security": "tls",',
      '    "masqueSettings": { "user": "${2:user}", "pass": "${3:password}" }',
      "  }",
      "}",
    ].join("\n"),
  },
  {
    label: "inbound:masque",
    detail: "MASQUE inbound (Xray >= 26.9.30)",
    insertText: [
      "{",
      '  "tag": "masque-in",',
      '  "port": 443,',
      '  "protocol": "masque",',
      '  "settings": {',
      '    "users": [{ "email": "${1:user@masque}", "pass": "${2:password}" }],',
      '    "address": ["10.77.0.1/24"]',
      "  },",
      '  "streamSettings": { "network": "masque", "security": "tls" }',
      "}",
    ].join("\n"),
  },
  {
    label: "streamSettings:xdrive",
    detail: "XDRIVE transport, Google Drive (Xray >= 26.9.30)",
    insertText: [
      '"streamSettings": {',
      '  "network": "xdrive",',
      '  "xdriveSettings": {',
      '    "service": "Google Drive",',
      '    "remoteFolder": "${1:xray}",',
      '    "secrets": ["${2:clientId}", "${3:clientSecret}", "${4:refreshToken}"]',
      "  }",
      "}",
    ].join("\n"),
  },
  {
    label: "finalmask:noise exp",
    detail: "Noise finalmask with template packet (Xray >= 26.9.30)",
    insertText: [
      '"finalmask": {',
      '  "udp": [{ "type": "noise", "settings": { "noise": [{ "type": "exp", "packet": "<b 0x${1:1234}><r 16>", "delay": "10-20" }] } }]',
      "}",
    ].join("\n"),
  },
  {
    label: "xdns:names/addrs",
    detail: "XDNS finalmask, new field names (Xray >= 26.10.10)",
    insertText: [
      '{ "type": "xdns", "settings": {',
      '  "domains": [{ "names": ["${1:t.example.com}"] }],',
      '  "resolvers": [{ "addrs": ["${2:1.1.1.1}"] }]',
      "} }",
    ].join("\n"),
  },
  {
    label: "script (Lua)",
    detail: "Lua script for dns / routing (Xray >= 26.10.10)",
    insertText: '"script": "${1:route.lua}"',
  },
  {
    label: "outbound:freedom",
    detail: "Freedom outbound",
    insertText: [
      "{",
      '  "tag": "direct",',
      '  "protocol": "freedom",',
      '  "settings": {}',
      "}",
    ].join("\n"),
  },
  {
    label: "routing rule",
    detail: "Routing rule block",
    insertText: [
      "{",
      '  "type": "field",',
      '  "outboundTag": "direct",',
      '  "domain": ["geosite:category-ads-all"]',
      "}",
    ].join("\n"),
  },
];

/** Register JSON completion snippets for xray Monaco editors (path prefix xray-). */
export function registerXrayMonacoSnippets(monaco: Monaco): { dispose: () => void } {
  const provider = {
    triggerCharacters: ['"'],
    provideCompletionItems: (
      model: { uri: { path: string }; getWordUntilPosition: (p: unknown) => { startColumn: number; endColumn: number } },
      position: { lineNumber: number },
    ) => {
      const path = model.uri.path;
      if (!path.includes("xray")) {
        return { suggestions: [] };
      }
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const suggestions = XRAY_SNIPPETS.map((s) => ({
        label: s.label,
        kind: monaco.languages.CompletionItemKind.Snippet,
        insertText: s.insertText,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        detail: s.detail,
        range,
      }));
      return { suggestions };
    },
  };
  const disposable = monaco.languages.registerCompletionItemProvider("json", provider);
  return { dispose: () => disposable.dispose() };
}
