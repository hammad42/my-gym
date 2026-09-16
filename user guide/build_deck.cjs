/* Builds the MyGym screenshot deck (dark theme, matches the app UI). */
const pptxgen = require("pptxgenjs");

const SHOTS = "D:/projects/my_gym/user guide/screenshots";
const OUT = "D:/projects/my_gym/user guide/MyGym-Screenshots.pptx";

// Palette: the app's own dark slate + orange, so screenshots blend seamlessly.
const BG = "0F172A";        // slate-950 — carries every slide
const CARD = "1E293B";      // slate-800 — panel tint
const PRIMARY = "EA580C";   // orange-600 — brand
const ACCENT = "F59E0B";    // amber-500 — single sharp accent
const TEXT = "F1F5F9";      // slate-100
const MUTED = "94A3B8";     // slate-400

const W = 13.33, H = 7.5, M = 0.6;
const FONT = "Segoe UI";

let pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.author = "Z.ai";
pres.title = "MyGym - Feature Walkthrough";

// Screenshot geometry: 414x880 -> h 5.7" => w 2.683"
const SHOT_H = 5.7;
const SHOT_W = SHOT_H * (414 / 880);

const makeShadow = () => ({ type: "outer", color: "000000", blur: 10, offset: 3, angle: 90, opacity: 0.45 });

/** Phone screenshot in a rounded frame at x, vertically centered. */
function phone(slide, file, x) {
  const y = (H - SHOT_H) / 2;
  slide.addShape("roundRect", {
    x: x - 0.06, y: y - 0.06, w: SHOT_W + 0.12, h: SHOT_H + 0.12,
    fill: { color: CARD }, rectRadius: 0.12, shadow: makeShadow(),
  });
  slide.addImage({ path: `${SHOTS}/${file}`, x, y, w: SHOT_W, h: SHOT_H });
}

/** Slide title + kicker, consistent on every content slide. */
function header(slide, kicker, title) {
  slide.addText(kicker.toUpperCase(), {
    x: M, y: 0.42, w: W - 2 * M, h: 0.32, fontSize: 12, fontFace: FONT,
    color: ACCENT, bold: true, charSpacing: 3, margin: 0,
  });
  slide.addText(title, {
    x: M, y: 0.72, w: W - 2 * M, h: 0.75, fontSize: 34, fontFace: FONT,
    color: TEXT, bold: true, margin: 0,
  });
}

const bu = () => ({ code: "25B8", indent: 12 });

/** Feature rows: bold lead + description, no container boxes. */
function rows(slide, items, x, y, w, gap = 0.92) {
  items.forEach((it, i) => {
    const ry = y + i * gap;
    slide.addShape("roundRect", {
      x, y: ry + 0.06, w: 0.14, h: 0.14, fill: { color: PRIMARY }, rectRadius: 0.03,
    });
    slide.addText([
      { text: it.title, options: { bold: true, color: TEXT, breakLine: true } },
      { text: it.desc, options: { color: MUTED } },
    ], {
      x: x + 0.32, y: ry - 0.06, w: w - 0.32, h: gap, fontSize: 13.5,
      fontFace: FONT, margin: 0, valign: "top", paraSpaceAfter: 2,
    });
  });
}

/* ---------- 1. Cover ---------- */
{
  const s = pres.addSlide();
  s.background = { color: BG };
  phone(s, "01-home-dashboard.png", W - SHOT_W - 0.85);
  s.addText("OFFLINE-FIRST WORKOUT TRACKER", {
    x: M, y: 1.55, w: 8.6, h: 0.4, fontSize: 13, fontFace: FONT,
    color: ACCENT, bold: true, charSpacing: 3, margin: 0,
  });
  s.addText("MyGym", {
    x: M, y: 1.95, w: 8.6, h: 1.5, fontSize: 76, fontFace: FONT,
    color: TEXT, bold: true, margin: 0,
  });
  s.addText("Plan routines. Log every set. See the progress.", {
    x: M, y: 3.5, w: 8.6, h: 0.55, fontSize: 21, fontFace: FONT,
    color: MUTED, margin: 0,
  });
  s.addText([
    { text: "100% offline  ", options: { bold: true, color: TEXT } },
    { text: "\u2022  data stays on your device  ", options: { color: MUTED } },
    { text: "\u2022  optional Google Sheets backup", options: { color: MUTED } },
  ], { x: M, y: 4.25, w: 8.6, h: 0.45, fontSize: 15, fontFace: FONT, margin: 0 });
  s.addText("USER GUIDE \u00B7 FEATURE WALKTHROUGH", {
    x: M, y: 6.6, w: 8, h: 0.35, fontSize: 11, fontFace: FONT,
    color: MUTED, charSpacing: 2, margin: 0,
  });
}

/* ---------- 2. Getting started ---------- */
{
  const s = pres.addSlide();
  s.background = { color: BG };
  header(s, "Setup", "Get it on your home screen");
  phone(s, "01-home-dashboard.png", M);
  const tx = M + SHOT_W + 0.7;
  const steps = [
    ["Open the app", "my-gym-hammad42.netlify.app in Chrome or Safari."],
    ["Add to Home screen", "Android: menu \u2192 Add to Home screen.  iPhone: Share \u2192 Add to Home Screen."],
    ["Launch from the icon", "Opens full-screen and works with no signal at all."],
    ["First launch", "Demo workouts, 21 exercises and 3 routines are seeded so charts have data."],
    ["Go live when ready", "Settings \u203A Clear all logged workouts keeps routines, drops samples."],
  ];
  rows(s, steps.map(([t, d]) => ({ title: t, desc: d })), tx, 1.75, W - tx - M, 1.0);
}

/* ---------- 3. Home dashboard ---------- */
{
  const s = pres.addSlide();
  s.background = { color: BG };
  header(s, "Home", "Your training dashboard");
  phone(s, "01-home-dashboard.png", M);
  rows(s, [
    { title: "This Week", desc: "Sessions vs your weekly goal, with a progress bar." },
    { title: "Streak", desc: "Consecutive weeks hitting the goal - the flame badge." },
    { title: "Sets / Volume / Time", desc: "This week's totals. Warm-ups count as sets, not volume." },
    { title: "Start a routine", desc: "One tap pre-fills a workout with the plan." },
    { title: "Recent sessions", desc: "Your last five workouts at a glance." },
  ], M + SHOT_W + 0.7, 1.8, W - (M + SHOT_W + 0.7) - M, 1.0);
}

/* ---------- 4. Logging a workout ---------- */
{
  const s = pres.addSlide();
  s.background = { color: BG };
  header(s, "Log", "Logging a workout");
  phone(s, "02-log-workout.png", M);
  rows(s, [
    { title: "Session details", desc: "Name, date (today by default), duration, body weight, notes." },
    { title: "Add exercises & sets", desc: "New sets carry the previous weight and reps forward." },
    { title: "W = warm-up", desc: "Warm-up sets are excluded from volume and records." },
    { title: "Live ~1RM", desc: "Estimated one-rep max updates as you type (Epley)." },
    { title: "Sticky footer", desc: "Running set count and total volume before you save." },
    { title: "Save", desc: "One atomic write - session and sets land together." },
  ], M + SHOT_W + 0.7, 1.62, W - (M + SHOT_W + 0.7) - M, 0.92);
}

/* ---------- 5. Rest timer + draft recovery ---------- */
{
  const s = pres.addSlide();
  s.background = { color: BG };
  header(s, "Built for the gym floor", "Rest timer & draft recovery");
  phone(s, "03-rest-timer.png", M);
  phone(s, "10-draft-recovery.png", M + SHOT_W + 0.45);
  const tx = M + 2 * SHOT_W + 0.45 + 0.7;
  rows(s, [
    { title: "Deadline-based countdown", desc: "Screen lock and background tabs cannot drift it." },
    { title: "Beep + vibration", desc: "You know it finished from across the gym." },
    { title: "Survives navigation", desc: "The rest keeps running while you check history." },
    { title: "Auto-saved draft", desc: "Every keystroke is stored in the local database." },
    { title: "Resume banner", desc: "Return to find everything exactly where you left it." },
    { title: "Leave guard", desc: "The app asks before you walk away mid-workout." },
  ], tx, 1.62, W - tx - M, 0.92);
}

/* ---------- 6. History ---------- */
{
  const s = pres.addSlide();
  s.background = { color: BG };
  header(s, "History", "Every session, searchable");
  phone(s, "04-history-expanded.png", M);
  rows(s, [
    { title: "Grouped by day", desc: "Today, Yesterday, then dates - newest first." },
    { title: "Tap to expand", desc: "Every set as a chip: weight \u00D7 reps; blue = warm-up." },
    { title: "Best set", desc: "The heaviest set of the session, highlighted." },
    { title: "Search", desc: "Filter by workout name, exercise or notes." },
    { title: "Delete safely", desc: "Two-step confirm; sets are removed with the session." },
  ], M + SHOT_W + 0.7, 1.8, W - (M + SHOT_W + 0.7) - M, 1.0);
}

/* ---------- 7. Routines ---------- */
{
  const s = pres.addSlide();
  s.background = { color: BG };
  header(s, "Plan", "Routines: your training templates");
  phone(s, "05-routines.png", M);
  phone(s, "06-routine-editor.png", M + SHOT_W + 0.45);
  const tx = M + 2 * SHOT_W + 0.45 + 0.7;
  rows(s, [
    { title: "Plan chips", desc: "Each routine shows target sets \u00D7 reps per exercise." },
    { title: "One-tap start", desc: "The orange play button pre-fills a workout." },
    { title: "Full editor", desc: "Rename, day hint, add / reorder / remove exercises." },
    { title: "Targets", desc: "Set the sets and reps you're aiming for per exercise." },
    { title: "Archive, don't delete", desc: "Old routines hide without breaking history." },
  ], tx, 1.75, W - tx - M, 1.0);
}

/* ---------- 8. Progress ---------- */
{
  const s = pres.addSlide();
  s.background = { color: BG };
  header(s, "Progress", "Charts & personal records");
  phone(s, "07-progress.png", M);
  rows(s, [
    { title: "Sessions per week", desc: "Last 8 weeks; goal-hitting weeks glow orange." },
    { title: "Volume by muscle group", desc: "Tonnage per body part, working sets only." },
    { title: "Exercise progression", desc: "Heaviest working set per session, per exercise." },
    { title: "Personal records", desc: "Best set and best estimated 1RM, with dates." },
    { title: "Honest numbers", desc: "Warm-ups and bodyweight reps never fake a record." },
  ], M + SHOT_W + 0.7, 1.8, W - (M + SHOT_W + 0.7) - M, 1.0);
}

/* ---------- 9. Settings ---------- */
{
  const s = pres.addSlide();
  s.background = { color: BG };
  header(s, "Settings", "Make it yours, keep it accurate");
  phone(s, "08-settings-preferences.png", M);
  rows(s, [
    { title: "kg / lb conversion", desc: "Switching units rewrites stored weights - history stays correct." },
    { title: "Weekly goal", desc: "1-14 sessions; drives the Home bar and streak." },
    { title: "Rest timer length", desc: "15-600 seconds, applied to every new set." },
    { title: "Exercise library", desc: "Add custom exercises; used ones archive, never break." },
    { title: "Export / import", desc: "Full JSON backup; import shows what it will replace." },
  ], M + SHOT_W + 0.7, 1.75, W - (M + SHOT_W + 0.7) - M, 1.0);
}

/* ---------- 10. Google Sheets backup ---------- */
{
  const s = pres.addSlide();
  s.background = { color: BG };
  header(s, "Backup", "Google Sheets mirror");
  phone(s, "09-settings-sheets.png", M);
  rows(s, [
    { title: "Your own spreadsheet", desc: "A readable log, session summaries, routines, raw backup." },
    { title: "One-time setup", desc: "Copy the Apps Script, set your password, paste the URL." },
    { title: "Auto-sync 2\u00D7 daily", desc: "Background sync while online; never mid-workout." },
    { title: "Restore from sheet", desc: "Pull everything back down to any device." },
    { title: "Secret stays secret", desc: "The key authenticates requests; it is never stored in the sheet." },
    { title: "Chunked uploads", desc: "Years of training sync fine - payloads are split automatically." },
  ], M + SHOT_W + 0.7, 1.62, W - (M + SHOT_W + 0.7) - M, 0.92);
}

/* ---------- 11. Offline & troubleshooting ---------- */
{
  const s = pres.addSlide();
  s.background = { color: BG };
  header(s, "Good to know", "Offline by default");
  const facts = [
    ["Works with zero signal", "After the first load, every screen is available offline. Sync simply waits."],
    ["Storage is protected", "The app requests persistent storage so your browser cannot evict your data."],
    ["Updates are automatic", "New versions install on the next online launch; data is untouched."],
    ["Weekly volume is working sets", "Warm-ups count as sets but not as volume or records - by design."],
    ["Moving phones", "Export JSON on the old device, import on the new - or restore from the sheet."],
    ["Demo data", "First launch includes samples; clear them in Settings when you go live."],
  ];
  // Two-column fact grid (single grid slide in the deck).
  const colW = (W - 2 * M - 0.6) / 2;
  facts.forEach((f, i) => {
    const cx = M + (i % 2) * (colW + 0.6);
    const cy = 1.8 + Math.floor(i / 2) * 1.72;
    s.addShape("roundRect", {
      x: cx, y: cy, w: colW, h: 1.5, fill: { color: CARD }, rectRadius: 0.09,
    });
    s.addText([
      { text: f[0], options: { bold: true, color: TEXT, fontSize: 15, breakLine: true } },
      { text: f[1], options: { color: MUTED, fontSize: 12.5 } },
    ], { x: cx + 0.25, y: cy + 0.12, w: colW - 0.5, h: 1.3, fontFace: FONT, margin: 0, valign: "top" });
  });
}

/* ---------- 12. Closing ---------- */
{
  const s = pres.addSlide();
  s.background = { color: BG };
  s.addText("Ready for your next session?", {
    x: M, y: 2.3, w: W - 2 * M, h: 1.0, fontSize: 44, fontFace: FONT,
    color: TEXT, bold: true, align: "center", margin: 0,
  });
  s.addText([
    { text: "my-gym-hammad42.netlify.app", options: { bold: true, color: ACCENT, breakLine: true } },
    { text: "Add it to your home screen and start logging.", options: { color: MUTED } },
  ], {
    x: M, y: 3.5, w: W - 2 * M, h: 0.9, fontSize: 18, fontFace: FONT,
    align: "center", margin: 0,
  });
  s.addText("MYGYM \u00B7 PLAN \u00B7 LOG \u00B7 PROGRESS", {
    x: M, y: 6.6, w: W - 2 * M, h: 0.35, fontSize: 11, fontFace: FONT,
    color: MUTED, charSpacing: 3, align: "center", margin: 0,
  });
}

pres.writeFile({ fileName: OUT }).then(() => console.log("deck written:", OUT));
