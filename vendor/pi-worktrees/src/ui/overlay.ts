import path from "node:path";

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable } from "@earendil-works/pi-tui";
import { CURSOR_MARKER, Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { WorktreeStatus } from "../git/index.js";
export type WorktreeAction =
  | { type: "switch"; path: string }
  | { type: "create"; name?: string }
  | { type: "delete"; path: string; confirmed: boolean }
  | { type: "cancel" };

export interface WorktreeOverlayState {
  items: WorktreeStatus[];
}

export interface WorktreeOverlayTui {
  requestRender(): void;
}

type InputMode = "normal" | "search" | "create" | "delete";

interface RenderCache {
  key: string;
  lines: string[];
}

export class WorktreeOverlay implements Component, Focusable {
  focused = false;

  private selected = 0;
  private query = "";
  private createName = "";
  private deleteTarget?: WorktreeStatus;
  private inputMode: InputMode = "normal";
  private cache?: RenderCache;

  constructor(
    private readonly tui: WorktreeOverlayTui,
    private readonly theme: Theme,
    private readonly state: WorktreeOverlayState,
    private readonly done: (result: WorktreeAction | undefined) => void
  ) {}

  handleInput(data: string): void {
    if (this.inputMode === "create") {
      this.handleCreateInput(data);
      return;
    }

    if (this.inputMode === "delete") {
      this.handleDeleteInput(data);
      return;
    }

    if (this.inputMode === "search") {
      this.handleSearchInput(data);
      return;
    }

    if (matchesKey(data, "escape") || data === "q") {
      this.done({ type: "cancel" });
      return;
    }

    if (matchesKey(data, "up") || data === "k") {
      this.moveSelection(-1);
      return;
    }

    if (matchesKey(data, "down") || data === "j") {
      this.moveSelection(1);
      return;
    }

    if (matchesKey(data, "return")) {
      const item = this.filteredItems()[this.selected];
      if (item) {
        this.done({ type: "switch", path: item.path });
      }
      return;
    }

    if (data === "/") {
      this.inputMode = "search";
      this.changed();
      return;
    }

    if (this.isCreateShortcut(data)) {
      this.inputMode = "create";
      this.changed();
      return;
    }

    if (data === "d") {
      const item = this.filteredItems()[this.selected];
      if (item?.isManaged && !item.isCurrent) {
        this.deleteTarget = item;
        this.inputMode = "delete";
        this.changed();
      }
    }
  }

  render(width: number): string[] {
    const filtered = this.filteredItems();
    this.selected = Math.min(this.selected, Math.max(0, filtered.length - 1));
    const boxWidth = Math.max(4, Math.min(width, 68));
    const key = JSON.stringify({ width: boxWidth, selected: this.selected, query: this.query, createName: this.createName, deleteTarget: this.deleteTarget?.path, mode: this.inputMode, count: filtered.length });
    if (this.cache?.key === key) {
      return this.cache.lines;
    }

    const lines = this.renderLines(boxWidth, filtered);
    this.cache = { key, lines };
    return lines;
  }

  invalidate(): void {
    this.cache = undefined;
  }

  dispose(): void {}

  private handleSearchInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.inputMode = "normal";
      this.changed();
      return;
    }

    if (matchesKey(data, "return")) {
      const item = this.filteredItems()[this.selected];
      if (item) {
        this.done({ type: "switch", path: item.path });
      }
      return;
    }

    if (matchesKey(data, "up")) {
      this.moveSelection(-1);
      return;
    }

    if (matchesKey(data, "down")) {
      this.moveSelection(1);
      return;
    }

    if (matchesKey(data, "backspace")) {
      this.query = this.query.slice(0, -1);
      this.selected = 0;
      this.changed();
      return;
    }

    if (isPrintable(data)) {
      this.query += data;
      this.selected = 0;
      this.changed();
    }
  }

  private handleDeleteInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q") {
      this.inputMode = "normal";
      this.deleteTarget = undefined;
      this.changed();
      return;
    }

    if (matchesKey(data, "return") && this.deleteTarget) {
      this.done({ type: "delete", path: this.deleteTarget.path, confirmed: true });
    }
  }

  private handleCreateInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.inputMode = "normal";
      this.changed();
      return;
    }

    if (matchesKey(data, "return")) {
      const name = this.createName.trim();
      this.done({ type: "create", name: name || undefined });
      return;
    }

    if (matchesKey(data, "backspace")) {
      this.createName = this.createName.slice(0, -1);
      this.changed();
      return;
    }

    if (isPrintable(data)) {
      this.createName += data;
      this.changed();
    }
  }

  private moveSelection(delta: number): void {
    const count = this.filteredItems().length;
    if (count === 0) {
      this.selected = 0;
      this.changed();
      return;
    }

    this.selected = Math.max(0, Math.min(count - 1, this.selected + delta));
    this.changed();
  }

  private filteredItems(): WorktreeStatus[] {
    const query = this.query.trim().toLowerCase();
    if (query.length === 0) {
      return this.state.items;
    }

    return this.state.items.filter((item) => {
      const text = `${path.basename(item.path)} ${item.branch ?? ""} ${item.path}`.toLowerCase();
      return text.includes(query);
    });
  }

  private renderLines(width: number, items: WorktreeStatus[]): string[] {
    const innerWidth = width - 2;
    const lines: string[] = [];

    lines.push(this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`));
    lines.push(this.row(width, ` ${this.theme.fg("accent", "Worktrees")} ${this.theme.fg("dim", `${items.length} found`)}`));
    lines.push(this.row(width, ` ${this.badge("/")} ${this.formatInput(this.query, this.inputMode === "search")}`));
    lines.push(this.row(width, ""));

    if (items.length === 0) {
      lines.push(this.row(width, ` ${this.theme.fg("dim", "No worktrees found")}`));
    } else {
      items.slice(0, 8).forEach((item, index) => lines.push(this.row(width, this.formatItem(item, index))));
    }

    lines.push(this.row(width, ""));
    if (this.inputMode === "create") {
      lines.push(this.row(width, ` Name ${this.formatInput(this.createName, true)} ${this.theme.fg("dim", "empty = auto")}`));
      lines.push(this.row(width, ` ${this.badge("Enter")} Create  ${this.badge("Esc")} Cancel`));
    } else if (this.inputMode === "delete" && this.deleteTarget) {
      const dirty = this.deleteTarget.isDirty ? ` ${this.badge("dirty", "warning")}` : "";
      lines.push(this.row(width, ` Delete worktree? ${this.theme.fg("text", path.basename(this.deleteTarget.path))}${dirty}`));
      lines.push(this.row(width, ` ${this.badge("Enter", "warning")} Delete  ${this.badge("Esc")} Cancel`));
    } else {
      lines.push(this.row(width, ` ${this.badge("↑↓")} Move  ${this.badge("Enter")} Open  ${this.badge("⌘N")} New`));
      lines.push(this.row(width, ` ${this.badge("D")} Delete  ${this.badge("Esc")} Close`));
    }

    lines.push(this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));
    return lines;
  }

  private formatItem(item: WorktreeStatus, index: number): string {
    const isSelected = index === this.selected;
    const pointer = isSelected ? this.theme.fg("accent", "▶") : " ";
    const name = path.basename(item.path);
    const branch = item.branch ?? (item.isDetached ? "detached" : "unknown");
    const dirty = item.isDirty ? this.badge("dirty", "warning") : this.badge("clean", "success");
    const current = item.isCurrent ? this.badge("current", "accent") : undefined;
    const project = item.isManaged ? undefined : this.badge("project", "accent");
    const label = isSelected ? this.theme.fg("accent", name) : this.theme.fg("text", name);
    const badges = [dirty, current, project].filter((badge) => badge !== undefined).join(" ");

    return ` ${pointer} ${label} ${this.theme.fg("dim", branch)} ${badges}`;
  }

  private formatInput(value: string, isFocused: boolean): string {
    if (!isFocused) {
      return value.length > 0 ? this.theme.fg("text", value) : this.theme.fg("dim", "<empty>");
    }

    const marker = this.focused ? CURSOR_MARKER : "";
    return `${this.theme.fg("text", value)}${marker}\x1b[7m \x1b[27m`;
  }

  private row(width: number, content: string): string {
    const innerWidth = width - 2;
    const clipped = truncateToWidth(content, innerWidth, "…", true);
    const padding = Math.max(0, innerWidth - visibleWidth(clipped));
    return `${this.theme.fg("border", "│")}${clipped}${" ".repeat(padding)}${this.theme.fg("border", "│")}`;
  }

  private badge(text: string, color: "accent" | "success" | "warning" = "accent"): string {
    return this.theme.fg(color, `[${text}]`);
  }

  private isCreateShortcut(data: string): boolean {
    return data === "n" || matchesKey(data, Key.super("n"));
  }

  private changed(): void {
    this.invalidate();
    this.tui.requestRender();
  }
}

function isPrintable(data: string): boolean {
  return data.length === 1 && data.charCodeAt(0) >= 32;
}
