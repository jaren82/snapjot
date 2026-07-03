// SnapJot content script
// Select a region → annotate with box/text → copy to clipboard. Zero dependencies.
(() => {
  // Guard against double-injection (re-click) so listeners aren't duplicated
  if (window.__snapjotInit) return;
  window.__snapjotInit = true;

  const Z = 2147483640; // sit above page content
  const RED = "#ff3b30";
  const FONT = "-apple-system,system-ui,Segoe UI,Roboto,sans-serif";
  const t = (k) => chrome.i18n.getMessage(k) || k; // localized string
  let session = null;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "SNAPJOT_START") start(msg.dataUrl);
  });

  function start(dataUrl) {
    if (session) cleanup();
    const img = new Image();
    img.onload = () => initSelection(img);
    img.onerror = () => console.warn("[SnapJot] image load failed");
    img.src = dataUrl;
  }

  // ---------- helpers ----------
  function el(tag, style, parent) {
    const e = document.createElement(tag);
    if (style) Object.assign(e.style, style);
    if (parent) parent.appendChild(e);
    return e;
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      cleanup();
    }
  }

  function cleanup() {
    if (!session) return;
    document.removeEventListener("keydown", onKey, true);
    (session.detachers || []).forEach((fn) => {
      try {
        fn();
      } catch (_) {}
    });
    if (session.root && session.root.parentNode)
      session.root.parentNode.removeChild(session.root);
    session = null;
  }

  function toast(text, accent) {
    const el2 = el(
      "div",
      {
        position: "fixed",
        left: "50%",
        bottom: "36px",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        background: "rgba(20,20,22,0.95)",
        color: "#fff",
        font: "600 14px/1.4 " + FONT,
        padding: "11px 18px",
        borderRadius: "11px",
        zIndex: String(Z + 5),
        boxShadow:
          "0 10px 32px rgba(0,0,0,0.4), 0 0 0 0.5px rgba(255,255,255,0.14)",
        pointerEvents: "none",
      },
      document.body
    );
    const check =
      '<svg width="17" height="17" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="' +
      (accent || RED) +
      '"/><path d="m4.8 8.2 2.2 2.2 4.2-4.6" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    el2.innerHTML = check + "<span>" + text + "</span>";
    setTimeout(() => el2.remove(), 2800);
  }

  // ---------- step 1: region selection ----------
  function initSelection(img) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scaleX = img.naturalWidth / vw; // ≈ devicePixelRatio
    const scaleY = img.naturalHeight / vh;

    const root = el("div", {
      position: "fixed",
      inset: "0",
      zIndex: String(Z),
      cursor: "crosshair",
      userSelect: "none",
    });
    document.documentElement.appendChild(root);
    session = { root, img, scaleX, scaleY, detachers: [] };
    document.addEventListener("keydown", onKey, true);

    // captured frame as a stable backdrop
    const backdrop = el(
      "img",
      {
        position: "absolute",
        left: "0",
        top: "0",
        width: vw + "px",
        height: vh + "px",
        display: "block",
      },
      root
    );
    backdrop.src = img.src;

    const dim = el(
      "div",
      { position: "absolute", inset: "0", background: "rgba(0,0,0,0.45)" },
      root
    );

    const sel = el(
      "div",
      {
        position: "absolute",
        border: "2px solid " + RED,
        boxShadow: "0 0 0 100000px rgba(0,0,0,0.45)",
        display: "none",
        pointerEvents: "none",
      },
      root
    );

    const hint = el(
      "div",
      {
        position: "absolute",
        left: "50%",
        top: "24px",
        transform: "translateX(-50%)",
        background: "rgba(20,20,20,0.9)",
        color: "#fff",
        font: "600 13px/1.4 " + FONT,
        padding: "8px 14px",
        borderRadius: "8px",
        pointerEvents: "none",
      },
      root
    );
    hint.textContent = t("hintSelect");

    const sizeLabel = el(
      "div",
      {
        position: "absolute",
        background: RED,
        color: "#fff",
        font: "600 12px/1 " + FONT,
        padding: "3px 6px",
        borderRadius: "4px",
        display: "none",
        pointerEvents: "none",
      },
      root
    );

    let startX = 0,
      startY = 0,
      dragging = false;

    const rectFrom = (e) => ({
      x: Math.min(startX, e.clientX),
      y: Math.min(startY, e.clientY),
      w: Math.abs(e.clientX - startX),
      h: Math.abs(e.clientY - startY),
    });

    function onDown(e) {
      if (e.button !== 0) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      dim.style.display = "none"; // sel's box-shadow handles the dimming
      sel.style.display = "block";
      sizeLabel.style.display = "block";
      hint.style.display = "none";
      e.preventDefault();
    }
    function onMove(e) {
      if (!dragging) return;
      const r = rectFrom(e);
      Object.assign(sel.style, {
        left: r.x + "px",
        top: r.y + "px",
        width: r.w + "px",
        height: r.h + "px",
      });
      sizeLabel.textContent = r.w + " × " + r.h;
      sizeLabel.style.left = r.x + "px";
      sizeLabel.style.top = Math.max(0, r.y - 22) + "px";
    }
    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      const r = rectFrom(e);
      if (r.w < 5 || r.h < 5) {
        cleanup();
        return;
      }
      root.removeEventListener("mousedown", onDown);
      sel.style.display = "none";
      sizeLabel.style.display = "none";
      enterAnnotate(r);
    }

    root.addEventListener("mousedown", onDown);
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
    session.detachers.push(() => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
    });
  }

  // ---------- step 2: annotate ----------
  function enterAnnotate(rect) {
    const { img, scaleX, scaleY, root } = session;
    root.style.cursor = "default";

    // crop at native resolution
    const cw = Math.round(rect.w * scaleX);
    const ch = Math.round(rect.h * scaleY);
    const crop = document.createElement("canvas");
    crop.width = cw;
    crop.height = ch;
    crop
      .getContext("2d")
      .drawImage(img, rect.x * scaleX, rect.y * scaleY, cw, ch, 0, 0, cw, ch);

    const canvas = el(
      "canvas",
      {
        position: "fixed",
        left: rect.x + "px",
        top: rect.y + "px",
        width: rect.w + "px",
        height: rect.h + "px",
        zIndex: String(Z + 1),
        boxShadow: "0 0 0 2px " + RED + ", 0 8px 30px rgba(0,0,0,0.4)",
        cursor: "crosshair",
      },
      root
    );
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");

    const annotations = [];
    let preview = null;
    let tool = "box";
    const COLORS = ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#007aff"];
    let color = COLORS[0];
    // readable text on a colored bubble (yellow needs dark text)
    const inkFor = (c) => {
      const n = parseInt(c.slice(1), 16);
      const L =
        0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
      return L > 186 ? "#3a3000" : "#fff";
    };
    const scale = cw / rect.w; // display→native ≈ dpr
    const lineW = Math.max(2, Math.round(3 * scale));
    const fontPx = Math.round(20 * scale);

    function drawOne(a) {
      const col = a.color || RED;
      if (a.type === "box") {
        ctx.lineWidth = lineW;
        ctx.strokeStyle = col;
        ctx.strokeRect(a.x, a.y, a.w, a.h);
      } else if (a.type === "arrow") {
        // defect-inspection sticker: chunky arrow, tip at the clicked spot,
        // body extending down-right (pointing ↖), white outline + drop shadow
        const u = fontPx / 20; // size unit
        const headL = 22 * u,
          headW = 26 * u,
          shaftW = 11 * u,
          shaftL = 20 * u;
        ctx.save();
        ctx.translate(a.x, a.y);
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(headW / 2, headL);
        ctx.lineTo(shaftW / 2, headL);
        ctx.lineTo(shaftW / 2, headL + shaftL);
        ctx.lineTo(-shaftW / 2, headL + shaftL);
        ctx.lineTo(-shaftW / 2, headL);
        ctx.lineTo(-headW / 2, headL);
        ctx.closePath();
        ctx.shadowColor = "rgba(0,0,0,0.4)";
        ctx.shadowBlur = 6 * u;
        ctx.shadowOffsetY = 2 * u;
        ctx.fillStyle = col;
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.lineWidth = Math.max(1.5, 2.2 * u);
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#fff";
        ctx.stroke();
        ctx.restore();
      } else {
        // text label: clean rounded chip at the clicked spot (no tail —
        // pointing is the arrow sticker's job)
        ctx.font = "700 " + fontPx + "px " + FONT;
        const padX = Math.round(fontPx * 0.55);
        const padY = Math.round(fontPx * 0.4);
        const tw = ctx.measureText(a.text).width;
        const bw = tw + padX * 2;
        const bh = fontPx + padY * 2;
        const rr = Math.round(bh * 0.32);
        const bx = Math.max(2, Math.min(Math.round(a.x), cw - bw - 2));
        const by = Math.max(2, Math.min(Math.round(a.y), ch - bh - 2));

        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = fontPx * 0.5;
        ctx.shadowOffsetY = Math.max(1, Math.round(fontPx * 0.08));
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, bh, rr);
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.fillStyle = inkFor(col);
        ctx.textBaseline = "top";
        ctx.fillText(a.text, bx + padX, by + padY);
        ctx.restore();
      }
    }
    function redraw() {
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(crop, 0, 0);
      annotations.forEach(drawOne);
      if (preview) drawOne(preview);
    }
    redraw();

    const toCanvas = (e) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (cw / r.width),
        y: (e.clientY - r.top) * (ch / r.height),
      };
    };

    // box drawing
    let drawing = false,
      sx = 0,
      sy = 0;
    function cDown(e) {
      if (tool === "box") {
        drawing = true;
        const p = toCanvas(e);
        sx = p.x;
        sy = p.y;
        preview = { type: "box", x: sx, y: sy, w: 0, h: 0, color };
        e.preventDefault();
      } else if (tool === "arrow") {
        e.preventDefault();
        const p = toCanvas(e);
        annotations.push({ type: "arrow", x: p.x, y: p.y, color });
        redraw();
      } else {
        // preventDefault stops the click's default focus-shift, which would
        // otherwise blur (and instantly remove) the input we're about to create
        e.preventDefault();
        addTextInput(e);
      }
    }
    function cMove(e) {
      if (!drawing) return;
      const p = toCanvas(e);
      preview = {
        type: "box",
        x: Math.min(sx, p.x),
        y: Math.min(sy, p.y),
        w: Math.abs(p.x - sx),
        h: Math.abs(p.y - sy),
        color,
      };
      redraw();
    }
    function cUp() {
      if (!drawing) return;
      drawing = false;
      if (preview && preview.w > 3 && preview.h > 3) annotations.push(preview);
      preview = null;
      redraw();
    }
    canvas.addEventListener("mousedown", cDown);
    document.addEventListener("mousemove", cMove, true);
    document.addEventListener("mouseup", cUp, true);
    session.detachers.push(() => {
      document.removeEventListener("mousemove", cMove, true);
      document.removeEventListener("mouseup", cUp, true);
    });

    // text input
    function addTextInput(e) {
      const p = toCanvas(e);
      // input styled like the final bubble (WYSIWYG), floated above the click
      const bubbleColor = color;
      const ink = inkFor(bubbleColor);
      const input = el(
        "input",
        {
          position: "fixed",
          left: Math.max(4, e.clientX) + "px",
          top: Math.max(4, e.clientY) + "px",
          font: "700 20px " + FONT,
          color: ink,
          background: bubbleColor,
          border: "none",
          borderRadius: "10px",
          padding: "7px 11px",
          zIndex: String(Z + 3),
          outline: "none",
          minWidth: "60px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
          caretColor: ink,
        },
        root
      );
      input.placeholder = t("notePlaceholder");
      const commit = () => {
        const text = input.value.trim();
        input.remove();
        if (text) {
          annotations.push({ type: "text", x: p.x, y: p.y, text, color: bubbleColor });
          redraw();
        }
      };
      input.addEventListener("keydown", (ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") commit();
        else if (ev.key === "Escape") input.remove();
      });
      // focus after the triggering click fully settles; only then arm the
      // blur-commit, so the input can't be blurred away in the same tick
      setTimeout(() => {
        input.focus();
        input.addEventListener("blur", commit);
      }, 50);
    }

    // toolbar — quiet dark bar; Copy (clipboard) is the single red primary
    const ICONS = {
      box: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1.7"/></svg>',
      text: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3.5 4.5V3h9v1.5M8 3v10M6 13h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      arrow:
        '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 3h6M3 3v6M3 3l6.2 6.2M9.5 13.5l1.7-4 2.6 2.6-4.3 1.4Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      undo: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6.5 3.5 3 7l3.5 3.5M3 7h6a4 4 0 0 1 0 8H8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      copy: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.7"/><path d="M10.5 3.5h-6a1 1 0 0 0-1 1v6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
      save: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 2.5v7m0 0 3-3m-3 3-3-3M3 11.5v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      close: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="m4 4 8 8m0-8-8 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    };

    const bar = el(
      "div",
      {
        position: "fixed",
        zIndex: String(Z + 2),
        display: "flex",
        alignItems: "center",
        gap: "3px",
        background: "rgba(24,24,26,0.97)",
        padding: "5px",
        borderRadius: "11px",
        boxShadow: "0 10px 32px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,255,255,0.14)",
        font: "600 12.5px " + FONT,
      },
      root
    );
    const barTop =
      rect.y + rect.h + 10 + 44 < window.innerHeight
        ? rect.y + rect.h + 10
        : Math.max(8, rect.y - 50);
    bar.style.left =
      Math.max(8, Math.min(rect.x, window.innerWidth - 480)) + "px";
    bar.style.top = barTop + "px";

    const IDLE = "transparent";
    const HOVER = "rgba(255,255,255,0.10)";
    function mkBtn(iconKey, label, title, on, primary) {
      const b = el(
        "button",
        {
          display: "inline-flex",
          alignItems: "center",
          gap: "5px",
          border: "none",
          borderRadius: "7px",
          padding: label ? "6px 10px" : "6px 7px",
          cursor: "pointer",
          color: primary ? "#fff" : "#d8d8dc",
          background: primary ? RED : IDLE,
          font: "inherit",
          whiteSpace: "nowrap",
          lineHeight: "1",
        },
        bar
      );
      b.innerHTML = ICONS[iconKey] + (label ? "<span>" + label + "</span>" : "");
      if (title) b.title = title;
      b.addEventListener("mouseenter", () => {
        if (!primary && b.dataset.active !== "1") b.style.background = HOVER;
        if (primary) b.style.background = "#e0342b";
      });
      b.addEventListener("mouseleave", () => {
        if (!primary && b.dataset.active !== "1") b.style.background = IDLE;
        if (primary) b.style.background = RED;
      });
      b.addEventListener("click", (ev) => {
        ev.preventDefault();
        on(b);
      });
      return b;
    }
    function divider() {
      el(
        "div",
        {
          width: "1px",
          height: "18px",
          background: "rgba(255,255,255,0.15)",
          margin: "0 3px",
        },
        bar
      );
    }

    const boxBtn = mkBtn("box", t("toolBox"), null, () => setTool("box"));
    const textBtn = mkBtn("text", t("toolText"), null, () => setTool("text"));
    const arrowBtn = mkBtn("arrow", null, t("toolArrow"), () => setTool("arrow"));
    divider();
    // color palette dots
    const dots = COLORS.map((c) => {
      const d = el(
        "button",
        {
          width: "16px",
          height: "16px",
          borderRadius: "50%",
          background: c,
          border: "2px solid transparent",
          padding: "0",
          cursor: "pointer",
          flex: "0 0 auto",
        },
        bar
      );
      d.addEventListener("click", (ev) => {
        ev.preventDefault();
        color = c;
        dots.forEach((o) => (o.style.border = "2px solid transparent"));
        d.style.border = "2px solid #fff";
      });
      return d;
    });
    dots[0].style.border = "2px solid #fff";
    divider();
    mkBtn("undo", null, t("toolUndo"), () => {
      annotations.pop();
      redraw();
    });
    divider();
    mkBtn("copy", t("toolCopy"), t("copyTitle"), copy, true);
    mkBtn("save", null, t("saveTitle"), savePng);
    mkBtn("close", null, null, cleanup);

    function setTool(tl) {
      tool = tl;
      canvas.style.cursor = tl === "text" ? "text" : "crosshair";
      const on = (b, active) => {
        b.dataset.active = active ? "1" : "0";
        b.style.background = active ? "rgba(255,255,255,0.16)" : IDLE;
        b.style.color = active ? "#fff" : "#d8d8dc";
      };
      on(boxBtn, tl === "box");
      on(textBtn, tl === "text");
      on(arrowBtn, tl === "arrow");
    }
    setTool("box");

    const toBlob = () =>
      new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

    async function copy() {
      try {
        // build ClipboardItem synchronously to keep the user-gesture activation
        const item = new ClipboardItem({ "image/png": toBlob() });
        await navigator.clipboard.write([item]);
        toast(t("copied"));
        cleanup();
      } catch (err) {
        console.warn("[SnapJot] clipboard failed, saving PNG:", err);
        downloadBlob(await toBlob());
        toast(t("copyFellBack"));
        cleanup();
      }
    }
    async function savePng() {
      downloadBlob(await toBlob());
      toast(t("savedPng"));
      cleanup();
    }
    function downloadBlob(blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "snapjot-" + Date.now() + ".png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
})();
