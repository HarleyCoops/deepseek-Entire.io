import { randomUUID as e } from "node:crypto";
import { existsSync as t, lstatSync as n, mkdirSync as r, readFileSync as i, renameSync as a, unlinkSync as o, writeFileSync as s } from "node:fs";
import { join as c } from "node:path";
import l from "node:process";
//#region src/controller.ts
var u = ".jspace", d = c(u, "WORKSPACE.md"), f = c(u, "history.json"), p = [
	"Goal",
	"Core",
	"Verified",
	"Open",
	"Next"
], m = 3, h = 1800, g = "You do not only produce words; you also think them before — and without —\nsaying them. The J-space holds what you are poised to say: concepts you can\nreport on demand, hold in mind deliberately, reason with silently, and\nbroadcast to many downstream computations at once. Dense on the inside,\ndecodable on demand.", _ = [
	"A marker fired and its move never happened — or it happened and you never settled.",
	"A sweep ran and found nothing — again.",
	"A dense line cannot be expanded back into plain words on request.",
	"Every confidence tag this session has been the same tag.",
	"A checkpoint was declared and nothing was written down.",
	"Something was called verified without stating what it covered.",
	"Dense notation appears in something a person or a task-facing tool reads.",
	"You called the task finished without reading the goal back line by line."
], v = "shift the abstraction, shift the strategy, or go and measure", y = [
	"⇒",
	"⟹",
	"⟸",
	"∴",
	"∵",
	"⊆",
	"⊇",
	"∋",
	"??",
	"?!",
	"💀"
], b = [
	"GRRR",
	"GAAAH",
	"PHEW",
	"I see meltdown",
	"DATA DATA",
	"I'M DROWNING"
], x = /\b(verified|confirmed|validated|tested|proven)\b/i, S = /(?:\b(?:all|each|every|cases?|inputs?|samples?|bounds?|boundaries|edges?|random(?:ized)?|files?|modules?|sections?|lines?|scenarios?|environments?|platforms?|datasets?|records?|routes?|commands?|branches?|ranges?|including|through|up\s+to|Windows|Linux|macOS|Chrome|Firefox|Safari)\b|\b(?:Python|Node(?:\.js)?)\s*\d|\bn\s*[<≤=]\s*\d)/i, C = class extends Error {};
function w(e) {
	return e instanceof Error ? e.message : String(e);
}
function T(e) {
	return p.some((t) => t === e);
}
function E(e) {
	if (typeof e != "object" || !e) return !1;
	let t = e;
	return Number.isInteger(t.t) && typeof t.next == "string" && Number.isInteger(t.verified) && Number.isInteger(t.open);
}
function D(e, t) {
	return t.has(e);
}
function O() {
	return {
		Goal: [],
		Core: [],
		Verified: [],
		Open: [],
		Next: []
	};
}
function k() {
	let e = O();
	if (!t(d)) return e;
	let n;
	try {
		n = J(d).split(/\r?\n/);
	} catch (e) {
		throw new C(`${d} (${w(e)})`, { cause: e });
	}
	let r;
	for (let t of n) {
		let n = t.trim();
		if (n.startsWith("## ")) {
			let e = n.slice(3).trim();
			r = T(e) ? e : void 0;
			continue;
		}
		if (!r || !n) continue;
		let i = !(r === "Goal" || r === "Next") && n.startsWith("- ") ? n.slice(2).trimEnd() : n.trimEnd();
		e[r].push(i);
	}
	return e;
}
function A() {
	try {
		t(u) || r(u, { recursive: !0 });
		let e = n(u);
		return e.isSymbolicLink() ? `${u} must not be a symbolic link` : e.isDirectory() ? void 0 : `${u} exists but is not a directory`;
	} catch (e) {
		return `${u} (${w(e)})`;
	}
}
function j(n, r) {
	let i = A();
	if (i) return i;
	let d = c(u, `.jspace-${l.pid}-${e()}`);
	try {
		s(d, r, {
			encoding: "utf8",
			flag: "wx"
		}), a(d, n);
		return;
	} catch (e) {
		try {
			t(d) && o(d);
		} catch {}
		return `${n} (${w(e)})`;
	}
}
function M(e) {
	let t = ["# J-Space Workspace Ledger", ""];
	for (let n of p) t.push(`## ${n}`), n === "Goal" || n === "Next" ? t.push(e[n][0] ?? "") : t.push(...e[n].map((e) => `- ${e}`)), t.push("");
	return j(d, `${t.join("\n").trimEnd()}\n`);
}
function N(e, t) {
	return e[t][0] ?? "";
}
function P(e) {
	if (e === void 0) return {};
	if (e.includes("\r") || e.includes("\n")) return { problem: "must be one line" };
	let t = e.trim();
	return t ? { value: t } : { problem: "must not be empty" };
}
function F(e, t) {
	let n = 0, r = t.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), i = RegExp(`^${r}(\\d+)\\b`, "u");
	for (let t of e) {
		let e = t.match(i);
		e && (n = Math.max(n, Number(e[1])));
	}
	return n + 1;
}
function I() {
	if (!t(f)) return [];
	try {
		let e = JSON.parse(J(f));
		if (!Array.isArray(e) || !e.every(E)) throw TypeError("invalid shape");
		return e;
	} catch (e) {
		return console.error(`WARNING: history was unreadable and has been restarted (${w(e)}).`), [];
	}
}
function L(e) {
	let t = I();
	t.push({
		t: Math.floor(Date.now() / 1e3),
		next: N(e, "Next"),
		verified: e.Verified.length,
		open: e.Open.length
	});
	let n = t.slice(-20), r = j(f, JSON.stringify(n));
	return r && console.error(`WARNING: recent seam history was not saved — ${r}`), n;
}
function R(e) {
	if (e.length < m) return [];
	let t = e.slice(-3), n = [], r = t[0], i = t.at(-1);
	new Set(t.map((e) => e.next)).size === 1 && r.next && n.push(`Your next action has been the same for ${m} seams.`), r.verified === i.verified && n.push(`Nothing new has been verified across those ${m} seams.`);
	let a = t.map((e) => e.open);
	return a.slice(1).every((e, t) => e > a[t]) && n.push("Open-question count increased at every seam."), r.verified !== i.verified && new Set(t.map((e) => e.next)).size === 1 && n.push("Verified entries are growing but the next action has not changed."), n;
}
function z(e) {
	console.log(`Goal:     ${N(e, "Goal") || "(not set)"}`);
	let t = e.Core.length ? e.Core : ["(empty)"];
	console.log(`Core:     ${t[0]}`), t[1] && console.log(`          ${t[1]}`), t.length > 2 && console.log(`          (+${t.length - 2} more in the ledger — two live at a time)`);
	let n = e.Verified;
	console.log(`Verified: ${n.at(-1) ?? "(none yet)"}`), n.length > 1 && console.log(`          (${n.length - 1} earlier, in the ledger)`);
	for (let t of e.Open.slice(0, 2)) console.log(`Open:     ${t}`);
	console.log(`Next:     ${N(e, "Next") || "(not set)"}`);
}
function B(e) {
	console.log(`Goal: ${N(e, "Goal") || "(not set)"}`), console.log("Core:"), e.Core.length ? e.Core.forEach((e, t) => console.log(`  [${t < 2 ? "live" : "parked"}] ${e}`)) : console.log("  (empty)"), console.log("Verified:"), e.Verified.length ? e.Verified.forEach((e) => console.log(`  ${e}`)) : console.log("  (none yet)"), console.log("Open:"), e.Open.length ? e.Open.forEach((e) => console.log(`  ${e}`)) : console.log("  (none)"), console.log(`Next: ${N(e, "Next") || "(not set)"}`);
}
function V(e, t) {
	console.log(t), console.log(g), console.log(), B(e), console.log("\nNot working if:"), _.forEach((e, t) => console.log(`  ${t + 1}. ${e}`)), console.log("\nState the current pass, then make Next name the first action back.");
}
function H(e) {
	let t = I(), n = t.length ? Math.floor(Date.now() / 1e3) - t.at(-1).t : 0;
	n > h ? V(e, `── j-space ─ seam (long gap: ${Math.floor(n / 60)} minutes since the last one)`) : (console.log("── j-space ─ seam"), z(e));
	let r = R(L(e));
	return r.length && (console.log(), r.forEach((e) => console.log(`· ${e}`)), console.log("\nYou would not have noticed that; I keep the record, so here it is."), console.log("If that is depth, carry on. If it is a stall, the moves open to you are:"), console.log(`  ${v}.`)), N(e, "Next") || console.log("\nThere is no next action recorded. The ledger stops being state at that point."), 0;
}
function U(e) {
	return V(e, "── j-space ─ resume"), L(e), 0;
}
function W(e, t) {
	let n = G(t), r = {
		goal: n.goal,
		core: n.core,
		coreSlot: Z(n["core-slot"], "--core-slot", [1, 2]),
		next: n.next,
		check: n.check,
		by: n.by,
		open: n.open,
		settledBy: n["settled-by"],
		close: Z(n.close, "--close")
	}, i = [], a = /* @__PURE__ */ new Set(), o = {
		goal: "--goal",
		core: "--core",
		next: "--next",
		check: "--check",
		by: "--by",
		open: "--open",
		settledBy: "--settled-by"
	};
	for (let e of Object.keys(o)) {
		let t = o[e], n = P(r[e]);
		r[e] = n.value, n.problem && (a.add(e), i.push([`${t} ${n.problem}.`, `${t} "one-line value"`]));
	}
	for (let e of ["goal", "next"]) r[e]?.startsWith("## ") && (r[e] = void 0, a.add(e), i.push([`${o[e]} must not begin with a ledger section heading ('## ').`, `${o[e]} "one-line value"`]));
	if (!(N(e, "Goal") || r.goal) || !(N(e, "Next") || r.next)) return i.push(["opening the ledger requires both Goal and Next.", "note --goal \"what done means\" --next \"the first action\""]), Q(i), 2;
	let s = !1;
	if (r.goal && (e.Goal = [r.goal], s = !0), r.core) if (!r.core.includes("—") && !r.core.includes(" - ")) i.push(["a core entry without its defining fact is a mention, not a load.", "--core \"name — the one fact that makes it matter\""]);
	else if (r.coreSlot === void 0) e.Core.includes(r.core) || (e.Core.push(r.core), s = !0);
	else {
		let t = e.Core.slice(0, 2), n = e.Core.slice(2), a = r.coreSlot - 1;
		if (a > t.length) i.push([`live core slot ${r.coreSlot} does not exist.`, "use the next available slot or add the entry without --core-slot"]);
		else if (t.includes(r.core) && (a >= t.length || t[a] !== r.core)) i.push(["that core entry is already live.", "choose the slot that should actually change"]);
		else if (a === t.length) t.push(r.core), e.Core = [...t, ...n], s = !0;
		else {
			let i = t[a];
			t[a] = r.core, n = n.filter((e) => e !== r.core), i !== r.core && n.unshift(i), e.Core = [...t, ...n], s ||= i !== r.core;
		}
	}
	else r.coreSlot !== void 0 && i.push(["--core-slot requires --core.", "--core \"name — defining fact\" --core-slot 1"]);
	let c = !1;
	if (r.check) if (!r.by) i.push(["a checkpoint with no record is not a checkpoint.", "--check \"what now holds\" --by \"what verified it\""]);
	else if (!S.test(r.by)) i.push(["verified without stated coverage is a mood, not a result.", "--by \"brute force, n ≤ 6, including empty and maximum\""]);
	else {
		let t = F(e.Verified, "✓");
		e.Verified.push(`✓${String(t).padStart(2, "0")} ${r.check} — verified by: ${r.by}`), s = !0, c = !0;
	}
	else r.by && !a.has("check") && i.push(["--by requires --check.", "--check \"what now holds\" --by \"verifier and coverage\""]);
	if (r.open) if (!r.settledBy) i.push(["an open question with nothing that would settle it cannot be closed.", "--open \"the question\" --settled-by \"the cheapest test that could refute it\""]);
	else {
		let t = F(e.Open, "?");
		e.Open.push(`?${String(t).padStart(2, "0")} ${r.open} — settled by: ${r.settledBy}`), s = !0;
	}
	else r.settledBy && !a.has("open") && i.push(["--settled-by requires --open.", "--open \"question\" --settled-by \"test\""]);
	if (r.close !== void 0) {
		let t = `?${String(r.close).padStart(2, "0")} `, n = e.Open.findIndex((e) => e.startsWith(t));
		n < 0 ? i.push([`no open question numbered ${r.close}.`, "run `seam` to see the list"]) : c ? (e.Open.splice(n, 1), s = !0) : i.push(["closing an open question requires a checkpoint in the same call.", `--close ${r.close} --check "what now holds" --by "verifier and coverage"`]);
	}
	if (r.next && (e.Next = [r.next], s = !0), s) {
		let t = M(e);
		if (t) return console.log(`CANNOT: cannot write the ledger — ${t}`), console.log("  free the path, or work without the file: keep the five lines in the"), console.log("  conversation and restate them at each seam."), 2;
	}
	return Q(i), i.length ? (s && console.log("  (everything else in this call was recorded.)"), 2) : (z(e), 0);
}
function G(e) {
	let t = new Set([
		"goal",
		"core",
		"core-slot",
		"next",
		"check",
		"by",
		"open",
		"settled-by",
		"close"
	]), n = {};
	for (let r = 0; r < e.length; r += 1) {
		let i = e[r];
		if (!i.startsWith("--")) throw TypeError(`unexpected argument "${i}"`);
		let a = i.indexOf("="), o = i.slice(2, a < 0 ? void 0 : a);
		if (!D(o, t)) throw TypeError(`unknown option "--${o}"`);
		if (Object.hasOwn(n, o)) throw TypeError(`option "--${o}" may appear only once`);
		let s = a < 0 ? e[++r] : i.slice(a + 1);
		if (s === void 0) throw TypeError(`option "--${o}" requires a value`);
		n[o] = s;
	}
	return n;
}
function K(e) {
	let t = [], n = e.split(/\r?\n/), r = [...new Set(y.filter((t) => e.includes(t)))].sort();
	r.length && t.push(`inner-register notation in outgoing text: ${r.join(" ")}`);
	let i = [...new Set(b.filter((t) => e.toLowerCase().includes(t.toLowerCase())))].sort();
	i.length && t.push(`state markers in outgoing text: ${i.join(", ")}`);
	let a = n.findIndex((e) => x.test(e) && !S.test(e));
	a >= 0 && t.push(`line ${a + 1}: "verified" with no stated coverage`);
	let o = 1;
	for (let e = 1; e < n.length; e += 1) {
		let r = n[e].trim();
		if (o = r && r === n[e - 1].trim() ? o + 1 : 1, o >= 3) {
			t.push("repetition loop: a line repeats three times or more");
			break;
		}
	}
	return /([.…\-'\s])\1{19,}/u.test(e) && t.push("repetition loop: a character run of 20 or more"), t.length ? (console.log("── j-space ─ ship"), t.slice(0, 7).forEach((e) => console.log(`· ${e}`)), console.log("\nThe switch is total: expand the span into clean language before it goes."), 0) : (console.log("clean — the outgoing register holds."), 0);
}
function q(e) {
	return Y(i(e));
}
function J(e) {
	if (n(e).isSymbolicLink()) throw TypeError(`${e} must not be a symbolic link`);
	return q(e);
}
function Y(e) {
	if (e.length >= 4 && e[0] === 255 && e[1] === 254 && e[2] === 0 && e[3] === 0) return X(e.subarray(4), !0);
	if (e.length >= 4 && e[0] === 0 && e[1] === 0 && e[2] === 254 && e[3] === 255) return X(e.subarray(4), !1);
	if (e.length >= 3 && e[0] === 239 && e[1] === 187 && e[2] === 191) return new TextDecoder("utf-8", { fatal: !0 }).decode(e.subarray(3));
	if (e.length >= 2 && e[0] === 255 && e[1] === 254) return new TextDecoder("utf-16le", { fatal: !0 }).decode(e.subarray(2));
	if (e.length >= 2 && e[0] === 254 && e[1] === 255) return new TextDecoder("utf-16be", { fatal: !0 }).decode(e.subarray(2));
	let t = new TextDecoder("utf-8", { fatal: !0 }).decode(e);
	if (t.includes("\0")) throw TypeError("NUL bytes suggest an unsupported encoding");
	return t;
}
function X(e, t) {
	if (e.length % 4 != 0) throw TypeError("truncated UTF-32 input");
	let n = "";
	for (let r = 0; r < e.length; r += 4) {
		let i = t ? e.readUInt32LE(r) : e.readUInt32BE(r);
		if (i > 1114111 || i >= 55296 && i <= 57343) throw TypeError("invalid UTF-32 code point");
		n += String.fromCodePoint(i);
	}
	return n;
}
function Z(e, t, n) {
	if (e === void 0) return;
	if (!/^\d+$/u.test(e)) throw TypeError(`${t} must be a positive integer`);
	let r = Number(e);
	if (!Number.isSafeInteger(r) || r < 1) throw TypeError(`${t} must be a positive integer`);
	if (n && !n.includes(r)) throw TypeError(`${t} must be ${n.join(" or ")}`);
	return r;
}
function Q(e) {
	for (let [t, n] of e) console.log(`NOT RECORDED: ${t}`), console.log(`  ${n}`);
}
function $() {
	console.log("Usage: jspace <command> [options]\n\nCommands:\n  seam                         show the ledger and recent movement\n  resume                       show the full re-entry anchor\n  note --goal TEXT --next TEXT open or update the ledger\n  note [options]               record core state, checks, and open questions\n  ship FILE                    inspect outgoing text; use - for stdin");
}
function ee(e) {
	let [t, ...n] = e;
	if (!t || t === "-h" || t === "--help" || t === "help") return $(), t ? 0 : 2;
	if (t === "ship") {
		if (n.length !== 1) throw TypeError("ship requires exactly one FILE (or - for stdin)");
		let e = n[0];
		return K(e === "-" ? Y(i(0)) : q(e));
	}
	if (t !== "seam" && t !== "resume" && t !== "note") throw TypeError(`unknown command "${t}"`);
	if (t !== "note" && n.length) throw TypeError(`${t} takes no arguments`);
	let r;
	try {
		r = k();
	} catch (e) {
		if (!(e instanceof C)) throw e;
		return console.log(`CANNOT: ledger was unreadable — ${e.message}.`), console.log("  repair or remove .jspace/WORKSPACE.md before recording more state"), 2;
	}
	return t === "seam" ? H(r) : t === "resume" ? U(r) : W(r, n);
}
try {
	l.exitCode = ee(l.argv.slice(2));
} catch (e) {
	console.log(`CANNOT: ${w(e)}.`), console.log("  run with --help to see the accepted command shape"), l.exitCode = 2;
}
//#endregion

//# sourceMappingURL=jspace.js.map