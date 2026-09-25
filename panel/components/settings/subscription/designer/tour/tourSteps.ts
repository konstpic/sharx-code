import type { TourStep, TourTrack } from "./tourLogic";

/**
 * All tour texts (English defaults). Keys live under `subBuilder.designer.` and are looked up with d().
 * `<step>.t` title, `<step>.b` body, `<step>.h` hint of a hands-on step.
 */
export const TOUR_TEXT: Record<string, string> = {
  "tour.menu": "Tour",
  "tour.menu.title": "Guided tour",
  "tour.menu.quick": "Quick start (2 min)",
  "tour.menu.full": "Full tour",
  "tour.menu.continue": "Continue tour",
  "tour.menu.reset": "Reset hints",
  "tour.menu.minis": "Short guides",
  "tour.mini.template": "Build a page from a template",
  "tour.mini.motion": "Make it move (animations & scenes)",
  "tour.mini.data": "Show client data with variables",
  "tour.mini.translate": "Translate your page",
  "tour.track.quick": "Quick start (2 min)",
  "tour.track.full": "Full tour",
  "tour.aria": "Designer tour",
  "tour.stepOf": "Step %{n} of %{total}",
  "tour.back": "Back",
  "tour.next": "Next",
  "tour.skip": "Skip tour",
  "tour.skipStep": "Skip this step",
  "tour.finish": "Finish",
  "tour.dontShow": "Don't show again",
  "tour.nice": "Nice, you did it!",
  "tour.try": "Your turn",
  "tour.choose.t": "Welcome to the page designer!",
  "tour.choose.b": "Build your subscription page block by block. Take a short tour? You can skip it any time.",
  "tour.choose.quick": "Quick start (2 min)",
  "tour.choose.quickHint": "The essentials, hands-on",
  "tour.choose.full": "Full tour",
  "tour.choose.fullHint": "Every corner of the designer",
  "tour.choose.later": "Not now",
  "tour.next.title": "What next?",

  "tour.s.welcome.t": "Your page, your rules",
  "tour.s.welcome.b": "Nothing changes for your clients until “Use on page” is on and you press Save. Experiment freely: Undo is always there.",

  "tour.s.toolbar.device.t": "Phone, tablet or desktop",
  "tour.s.toolbar.device.b": "Preview how the page looks on each screen.",
  "tour.s.toolbar.device.h": "Click another device",
  "tour.s.toolbar.undo.t": "Undo and redo",
  "tour.s.toolbar.undo.b": "Made a mistake? Step back with ⌘Z, forward with ⇧⌘Z.",
  "tour.s.toolbar.zoom.t": "Zoom",
  "tour.s.toolbar.zoom.b": "Zoom the canvas in and out, or fit it to the screen.",
  "tour.s.toolbar.templates.t": "Templates",
  "tour.s.toolbar.templates.b": "Start from a ready-made page instead of a blank one.",

  "tour.s.add.tab.t": "The Add tab",
  "tour.s.add.tab.b": "Everything you can put on the page lives here.",
  "tour.s.add.tab.h": "Open the Add tab",
  "tour.s.add.basic.t": "Basic elements",
  "tour.s.add.basic.b": "Text, buttons, images and more. Click one to add it, or drag it onto the page.",
  "tour.s.add.basic.h": "Click “Text” to add it",
  "tour.s.add.catalog.t": "The catalog",
  "tour.s.add.catalog.b": "Hundreds of ready-made pieces. Search by name to find one fast.",
  "tour.s.add.filters.t": "Filters",
  "tour.s.add.filters.b": "Narrow it down: animated, interactive, with client data and more.",
  "tour.s.add.view.t": "View modes",
  "tour.s.add.view.b": "Large previews, a compact grid, or a plain list. Pick what you like.",

  "tour.s.canvas.select.t": "The canvas",
  "tour.s.canvas.select.b": "This is your page. Click any element to select it.",
  "tour.s.canvas.select.h": "Click an element on the page",
  "tour.s.canvas.drag.t": "Drag to move",
  "tour.s.canvas.drag.b": "Grab a selected element and drag it to a new place. A blue line shows where it will land.",
  "tour.s.canvas.side.t": "Side by side",
  "tour.s.canvas.side.b": "Drop an element on the left or right edge of another one to put them in a row.",
  "tour.s.canvas.grid.t": "Magnetic grid",
  "tour.s.canvas.grid.b": "The grid helps you line things up neatly. Elements snap to it as you move them.",
  "tour.s.canvas.grid.h": "Turn the grid on (or press G)",

  "tour.s.insp.main.t": "The Inspector",
  "tour.s.insp.main.b": "Select something and tune it here: size, look, text and visibility.",
  "tour.s.insp.mobile.t": "Mobile look",
  "tour.s.insp.mobile.b": "Switch this to change how an element looks on phones only.",
  "tour.s.insp.motion.t": "Motion",
  "tour.s.insp.motion.b": "Add an entrance effect or hover animation in the Animation section.",

  "tour.s.vars.tab.t": "Variables",
  "tour.s.vars.tab.b": "Client data you can show on the page: name, traffic, expiry and more.",
  "tour.s.vars.ph.t": "Placeholders",
  "tour.s.vars.ph.b": "Write a variable in double curly braces inside any text, and it turns into the client's real value.",
  "tour.s.vars.tr.t": "Translations",
  "tour.s.vars.tr.b": "Texts of ready-made elements are stored here. Edit them per language.",

  "tour.s.style.tab.t": "Styles",
  "tour.s.style.tab.b": "Pick a palette for the whole page.",
  "tour.s.style.colors.t": "Background and colors",
  "tour.s.style.colors.b": "Switch the background style and fine-tune the colors until it feels like your brand.",

  "tour.s.tpl.open.t": "Templates gallery",
  "tour.s.tpl.open.b": "Let's see the templates.",
  "tour.s.tpl.open.h": "Click “Templates”",
  "tour.s.tpl.gallery.t": "Pick a look",
  "tour.s.tpl.gallery.b": "Choose a template to replace the current page. You can undo it. Close this window when done.",

  "tour.s.layers.t": "Layers",
  "tour.s.layers.b": "A tree of everything on the page. Select, reorder or hide elements here.",

  "tour.s.data.id.t": "Preview real data",
  "tour.s.data.id.b": "Paste a client's subId to see the page exactly as that client sees it.",
  "tour.s.data.lang.t": "Preview language",
  "tour.s.data.lang.b": "Check how the page reads in other languages.",

  "tour.s.pub.toggle.t": "Use on page",
  "tour.s.pub.toggle.b": "Turn this on to show your design to clients instead of the classic blocks.",
  "tour.s.pub.save.t": "Save and publish",
  "tour.s.pub.save.b": "Press Save to make it live. Until then, nothing changes for clients.",

  "tour.s.done.t": "You're all set!",
  "tour.s.done.b": "Reopen this tour any time with the Tour button. Happy building!",

  "tour.s.mo.filters.t": "Find animated pieces",
  "tour.s.mo.filters.b": "Switch on the “Animated” filter to see elements that move.",
  "tour.s.mo.scene.t": "Add a scene",
  "tour.s.mo.scene.b": "A scene is a small animated explainer. Add one to the page.",
  "tour.s.mo.scene.h": "Click “Scene” to add it",

  "tour.s.data.text.t": "Show client data",
  "tour.s.data.text.b": "Add a Text, then type a variable from the Variables tab inside it.",
  "tour.s.data.text.h": "Click “Text” to add it",

  "tour.s.tr.tip.t": "One page, many languages",
  "tour.s.tr.tip.b": "Write texts in several languages and the page switches by itself for each visitor.",
};

const S = (id: string, o: Omit<TourStep, "id">): TourStep => ({ id, ...o });

export const TOUR_STEPS: TourStep[] = [
  S("welcome", { icon: "Sparkles" }),
  S("toolbar.device", { target: "device-switch", icon: "Smartphone", task: "device" }),
  S("toolbar.undo", { target: "undo-redo", icon: "Undo2" }),
  S("toolbar.zoom", { target: "zoom", icon: "ZoomIn" }),
  S("toolbar.templates", { target: "templates-button", icon: "LayoutTemplate" }),
  S("add.tab", { target: "tab-add", icon: "Boxes", task: "tab:add" }),
  S("add.basic", { target: "basic-elements", icon: "Type", task: "nodeAdded", prepare: (a) => a.setLeft("add") }),
  S("add.catalog", { target: "catalog-search", icon: "Search", prepare: (a) => a.setLeft("add") }),
  S("add.filters", { target: "catalog-filters", icon: "Filter", prepare: (a) => a.setLeft("add") }),
  S("add.view", { target: "catalog-view", icon: "LayoutGrid", prepare: (a) => a.setLeft("add") }),
  S("canvas.select", { target: "canvas", icon: "MousePointerClick", task: "selection", prepare: (a) => a.select([]) }),
  S("canvas.drag", { target: "canvas", icon: "Move" }),
  S("canvas.side", { target: "canvas", icon: "Columns2" }),
  S("canvas.grid", { target: "grid-button", icon: "Grid3x3", task: "grid" }),
  S("insp.main", { target: "inspector", icon: "SlidersHorizontal" }),
  S("insp.mobile", { target: "inspector-mobile-switch", fallback: "inspector", icon: "Smartphone" }),
  S("insp.motion", { target: "inspector-motion", fallback: "inspector", icon: "Wand2" }),
  S("vars.tab", { target: "tab-vars", icon: "Variable", prepare: (a) => a.setLeft("vars") }),
  S("vars.ph", { target: "vars-panel", icon: "Braces", prepare: (a) => a.setLeft("vars") }),
  S("vars.tr", { target: "translations", fallback: "vars-panel", icon: "Languages", prepare: (a) => a.setLeft("vars") }),
  S("style.tab", { target: "tab-style", icon: "Palette", prepare: (a) => a.setLeft("style") }),
  S("style.colors", { target: "style-panel", icon: "Pipette", prepare: (a) => a.setLeft("style") }),
  S("tpl.open", { target: "templates-button", icon: "LayoutTemplate", task: "modal:presets" }),
  S("tpl.gallery", { target: "modal", icon: "Images", keepModal: true, prepare: (a, s) => s.modal !== "presets" && a.setModal("presets") }),
  S("layers", { target: "layers-panel", fallback: "tab-layers", icon: "Layers", prepare: (a) => a.setLeft("layers") }),
  S("data.id", { target: "client-id-input", icon: "UserSearch" }),
  S("data.lang", { target: "preview-lang", icon: "Globe" }),
  S("pub.toggle", { target: "publish-toggle", icon: "Rocket" }),
  S("pub.save", { target: "save-button", icon: "Save" }),
  S("done", { icon: "PartyPopper", next: true }),
  // mini-track only
  S("mo.filters", { target: "catalog-filters", icon: "Zap", prepare: (a) => a.setLeft("add") }),
  S("mo.scene", { target: "basic-scene", fallback: "basic-elements", icon: "Clapperboard", task: "nodeAdded", prepare: (a) => a.setLeft("add") }),
  S("data.text", { target: "basic-text", fallback: "basic-elements", icon: "Type", task: "nodeAdded", prepare: (a) => a.setLeft("add") }),
  S("tr.tip", { icon: "Languages" }),
];

const QUICK = ["welcome", "add.tab", "add.basic", "canvas.select", "insp.main", "style.tab", "pub.toggle", "pub.save", "done"];

export const TOUR_TRACKS: TourTrack[] = [
  { id: "quick", steps: QUICK },
  {
    id: "full",
    steps: TOUR_STEPS.map((s) => s.id).filter((id) => !["mo.filters", "mo.scene", "data.text", "tr.tip"].includes(id)),
  },
  { id: "template", steps: ["tpl.open", "tpl.gallery", "style.tab", "style.colors", "pub.toggle", "pub.save"] },
  { id: "motion", steps: ["mo.filters", "mo.scene", "insp.motion", "pub.save"] },
  { id: "data", steps: ["vars.tab", "vars.ph", "data.text", "data.id", "pub.save"] },
  { id: "translate", steps: ["vars.tr", "tr.tip", "data.lang", "pub.save"] },
];

export const MINI_TRACKS = ["template", "motion", "data", "translate"] as const;

export const stepById = (id: string): TourStep | undefined => TOUR_STEPS.find((s) => s.id === id);
export const trackById = (id: string): TourTrack | undefined => TOUR_TRACKS.find((t) => t.id === id);
