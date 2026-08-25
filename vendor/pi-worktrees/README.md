# pi-worktrees

<p align="center">
  <strong>A polished Pi extension for fast, focused Git worktree workflows.</strong>
</p>

<p align="center">
  <img alt="Version 0.1.0" src="https://img.shields.io/badge/version-0.1.0-blue">
  <img alt="Pi package" src="https://img.shields.io/badge/pi-package-7c3aed">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-ready-3178c6">
</p>

`pi-worktrees` adds a `/wt` command to [Pi](https://pi.dev/) for creating, switching, returning from, and deleting managed Git worktrees without leaving your coding session. It is built for clean branch isolation, quick experiments, and safer parallel work across tasks.

## Highlights

- **One-command worktrees**: create a new Git worktree and switch Pi into it immediately.
- **Native Pi experience**: interactive TUI overlay with search, keyboard navigation, badges, and confirmations.
- **Safe managed storage**: keeps Pi-created worktrees under a predictable managed directory.
- **Return flow**: jump back from a managed worktree to the original project with `/wt return`.
- **Optional change transfer**: move uncommitted changes with `--move` when creating or returning.
- **Deletion guardrails**: confirms destructive deletes and warns when a worktree has uncommitted changes.

## Requirements

- [Pi](https://pi.dev/) with extension support
- Node.js compatible with Pi extensions
- Git with `git worktree` support
- `pnpm` for local development

## Installation

### Install from npm

Install the extension in Pi with:

```sh
pi install npm:pi-worktrees
```

After installation, restart Pi or use `/reload` if your session supports hot reload. The `/wt` command will be available in your Pi session.

### Install from Git

After this repository is public, you can also install it directly from GitHub:

```sh
pi install git:github.com/0xkuze/pi-worktrees
```

For a one-off run without adding it to your settings:

```sh
pi -e git:github.com/0xkuze/pi-worktrees
```

### Use a local checkout

```sh
git clone git@github.com:0xkuze/pi-worktrees.git
cd pi-worktrees
pnpm install
pi -e ./src/index.ts
```

For hot reload during development, place or symlink the package into a Pi extension location such as `.pi/extensions/pi-worktrees/` or `~/.pi/agent/extensions/pi-worktrees/`, then use `/reload` inside Pi.

## Usage

Open the worktree overlay:

```text
/wt
```

Create a managed worktree and switch to it:

```text
/wt create feature-name
```

Create a worktree and move uncommitted changes into it:

```text
/wt create feature-name --move
```

Return from a managed worktree to the original project:

```text
/wt return
```

Return and move uncommitted changes back to the original project:

```text
/wt return --move
```

Delete a managed worktree:

```text
/wt delete /absolute/path/to/worktree
```

## Commands

| Command | Description |
| --- | --- |
| `/wt` | Opens the interactive worktree overlay. |
| `/wt create [name]` | Creates a managed worktree on branch `wt/<name>` and switches Pi to it. |
| `/wt create [name] --move` | Stashes current changes, creates the worktree, and pops the stash there. |
| `/wt return` | Returns from a managed worktree to the original project. |
| `/wt return --move` | Stashes worktree changes and pops them in the original project. |
| `/wt delete <path>` | Removes a managed worktree after confirmation. |

Aliases are also supported for convenience: `new` for `create`, `back` for `return`, and `remove`/`rm` for `delete`.

## TUI shortcuts

| Shortcut | Action |
| --- | --- |
| `↑` / `↓` or `j` / `k` | Move through the worktree list. |
| `/` | Search worktrees. |
| `Enter` | Switch to the selected worktree. |
| `⌘N` or `n` | Create a new worktree. |
| `d` | Delete the selected managed worktree. |
| `Esc` or `q` | Close the overlay. |

When the overlay is opened from a managed worktree, the original project appears with a `[project]` badge so you can return quickly.

## Managed storage

By default, managed worktrees are stored under:

```text
~/.local/share/pi-worktrees
```

Set `PI_WORKTREE_HOME` to choose a custom storage root:

```sh
export PI_WORKTREE_HOME="$HOME/.worktrees/pi"
```

Worktree names are normalized to kebab-case. If you omit a name, `pi-worktrees` generates one automatically.

## How change transfer works

When you pass `--move`, `pi-worktrees` uses Git stash commands across worktrees in the same repository:

1. `git stash push -u` in the source worktree
2. worktree creation or return navigation
3. `git stash pop` in the destination worktree

If you choose not to move changes, they remain in the current worktree.

## Development

Install dependencies:

```sh
pnpm install
```

Run the full validation suite:

```sh
pnpm check
```

Run only TypeScript validation:

```sh
pnpm build
```

Run tests:

```sh
pnpm test
```

## Project structure

```text
src/
  errors/    Error formatting and typed error helpers
  git/       Git command wrappers and worktree parsing
  session/   Pi session switching integration
  storage/   Managed paths, metadata, and name normalization
  ui/        TUI overlay implementation
  worktree/  Create, return, delete, and overlay data flows
```

## Publishing checklist

Before publishing or sharing publicly:

- Ensure the repository visibility is set to public on GitHub.
- Run `pnpm check` and confirm the build and tests pass.
- Review the package metadata in `package.json`.
- Choose and add a license if you want others to reuse, modify, or redistribute the code.

## Author

Created and maintained by **Cristian Fonseca**.
