/**
 * Server plugins.
 *
 * A plugin is one `.mjs` file in `plugins/` that exports a `register`
 * function. It gets a context object and hangs whatever it likes off it:
 * commands, event handlers, panels. Nothing in the core needs to know a
 * plugin exists, and a plugin needs no build step -- drop the file in,
 * restart, done.
 *
 * The bar this has to clear is that the economy itself goes through it. An
 * extension API that the project's own features bypass is one nobody can
 * trust: it will grow gaps exactly where the interesting work is, because
 * the interesting work never had to use it.
 *
 * Plugins run in-process with no sandbox. They can do anything the server
 * can, so this is not a safety boundary -- it is an organisation one. Only
 * install plugins you would be willing to run as a script, because that is
 * what they are.
 */

import { readdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import type { SPanel } from '@shared/protocol.js';

/** A connected player, as a plugin sees them. */
export interface PluginPlayer {
  id: number;
  name: string;
  dim: number;
  x: number;
  y: number;
  z: number;
}

/** What the server gives a plugin to work with. */
export interface PluginContext {
  /** The server's name, for anything a plugin shows to players. */
  serverName: string;

  /** Registers a chat command. Return true if it was handled. */
  command(
    name: string,
    help: string,
    run: (player: PluginPlayer, args: string) => void,
  ): void;

  /** Registers a panel builder, addressed by id from the client. */
  panel(
    id: string,
    build: (player: PluginPlayer, arg?: string, notice?: string) => SPanel,
  ): void;

  /** Registers a handler for a panel action. */
  panelAction(
    id: string,
    run: (player: PluginPlayer, action: string, arg?: string, count?: number) => SPanel,
  ): void;

  /** Listens for something happening. */
  on(event: 'join', fn: (player: PluginPlayer) => void): void;
  on(event: 'leave', fn: (player: PluginPlayer) => void): void;
  on(event: 'chat', fn: (player: PluginPlayer, text: string) => void): void;
  on(
    event: 'kill',
    fn: (killer: PluginPlayer, victim: PluginPlayer) => void,
  ): void;
  on(event: 'tick', fn: () => void): void;

  /** Sends a private line to one player. */
  tell(name: string, text: string): void;
  /** Sends a line to everyone. */
  broadcast(text: string): void;
  /** Everyone connected. */
  players(): PluginPlayer[];
  /** Puts items into a player's inventory. */
  grant(name: string, item: number, count: number): boolean;
  /** Takes items out, returning how many were actually taken. */
  take(name: string, item: number, count: number): number;
  /** A place to keep data that survives a restart. */
  storagePath(fileName: string): string;
  /** Writes a line to the server log, tagged with the plugin's name. */
  log(text: string): void;
}

type Handler = (...args: never[]) => void;

interface Command {
  plugin: string;
  help: string;
  run: (player: PluginPlayer, args: string) => void;
}

/**
 * Everything plugins have registered, and the calls into it.
 *
 * Kept as one object rather than scattered listeners so the server has a
 * single place to ask "does anything handle this?", and so a plugin that
 * throws can be named in the log rather than taking the tick down anonymously.
 */
export class PluginHost {
  private commands = new Map<string, Command>();
  private panels = new Map<string, { plugin: string; build: (p: PluginPlayer, arg?: string, notice?: string) => SPanel }>();
  private panelActions = new Map<string, { plugin: string; run: (p: PluginPlayer, action: string, arg?: string, count?: number) => SPanel }>();
  private listeners = new Map<string, Array<{ plugin: string; fn: Handler }>>();
  private loaded: string[] = [];

  constructor(private readonly base: Omit<PluginContext,
  'command' | 'panel' | 'panelAction' | 'on' | 'log'>) {}

  /** The names of everything loaded, for the startup line. */
  get names(): string[] {
    return [...this.loaded];
  }

  /** Commands and their help, for /help. */
  helpLines(): string[] {
    return [...this.commands.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, c]) => `/${name.padEnd(18)} ${c.help}`);
  }

  /** Builds the context a single plugin sees. */
  private contextFor(pluginName: string): PluginContext {
    return {
      ...this.base,
      command: (name, help, run) => {
        const key = name.toLowerCase();
        const existing = this.commands.get(key);
        if (existing) {
          // First registration wins, and the clash is reported. Silently
          // replacing would let one plugin quietly break another's commands.
          console.log(
            `[plugins] ${pluginName} wanted /${key}, already taken by ${existing.plugin}`);
          return;
        }
        this.commands.set(key, { plugin: pluginName, help, run });
      },
      panel: (id, build) => { this.panels.set(id, { plugin: pluginName, build }); },
      panelAction: (id, run) => { this.panelActions.set(id, { plugin: pluginName, run }); },
      on: (event: string, fn: Handler) => {
        const list = this.listeners.get(event) ?? [];
        list.push({ plugin: pluginName, fn });
        this.listeners.set(event, list);
      },
      log: (text) => console.log(`[${pluginName}] ${text}`),
    } as PluginContext;
  }

  /** Registers a plugin that is compiled into the server. */
  registerBuiltin(name: string, register: (ctx: PluginContext) => void): void {
    try {
      register(this.contextFor(name));
      this.loaded.push(name);
    } catch (err) {
      console.log(`[plugins] ${name} failed to load: ${describe(err)}`);
    }
  }

  /**
   * Loads every `.mjs` in a directory.
   *
   * One that throws is reported and skipped rather than stopping the server.
   * A server that will not boot because of one broken plugin is a server
   * whose owner cannot get in to remove the broken plugin.
   */
  async loadFrom(dir: string): Promise<void> {
    if (!existsSync(dir)) return;
    const files = readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();
    for (const file of files) {
      const name = file.replace(/\.mjs$/, '');
      try {
        const mod = await import(pathToFileURL(join(dir, file)).href);
        const register = mod.register ?? mod.default;
        if (typeof register !== 'function') {
          console.log(`[plugins] ${name} exports no register function; skipped`);
          continue;
        }
        register(this.contextFor(name));
        this.loaded.push(name);
      } catch (err) {
        console.log(`[plugins] ${name} failed to load: ${describe(err)}`);
      }
    }
  }

  /** Runs a chat command. Returns false if nothing owns it. */
  runCommand(player: PluginPlayer, text: string): boolean {
    if (!text.startsWith('/')) return false;
    const body = text.slice(1);
    const gap = body.search(/\s/);
    const name = (gap === -1 ? body : body.slice(0, gap)).toLowerCase();
    const args = gap === -1 ? '' : body.slice(gap + 1).trim();

    const cmd = this.commands.get(name);
    if (!cmd) return false;
    try {
      cmd.run(player, args);
    } catch (err) {
      console.log(`[plugins] ${cmd.plugin} threw on /${name}: ${describe(err)}`);
      this.base.tell(player.name, 'That command failed. The server log has why.');
    }
    return true;
  }

  /** Builds a panel, or null if nothing owns that id. */
  buildPanel(player: PluginPlayer, id: string, arg?: string, notice?: string): SPanel | null {
    const entry = this.panels.get(id);
    if (!entry) return null;
    try {
      return entry.build(player, arg, notice);
    } catch (err) {
      console.log(`[plugins] ${entry.plugin} threw building "${id}": ${describe(err)}`);
      return null;
    }
  }

  /** Runs a panel action, or null if nothing owns that id. */
  runPanelAction(
    player: PluginPlayer, id: string, action: string, arg?: string, count?: number,
  ): SPanel | null {
    const entry = this.panelActions.get(id);
    if (!entry) return null;
    try {
      return entry.run(player, action, arg, count);
    } catch (err) {
      console.log(`[plugins] ${entry.plugin} threw on "${id}/${action}": ${describe(err)}`);
      return null;
    }
  }

  /**
   * Fires an event at every listener.
   *
   * One that throws is logged and the rest still run. A plugin failing on
   * join must not stop the player joining, or one bad plugin locks everybody
   * out of the server.
   */
  emit(event: 'join' | 'leave' | 'tick', a: PluginPlayer | undefined): void;
  emit(event: 'chat', a: PluginPlayer, b: string): void;
  emit(event: 'kill', a: PluginPlayer, b: PluginPlayer): void;
  emit(event: string, ...args: unknown[]): void {
    for (const { plugin, fn } of this.listeners.get(event) ?? []) {
      try {
        (fn as (...a: unknown[]) => void)(...args);
      } catch (err) {
        console.log(`[plugins] ${plugin} threw on "${event}": ${describe(err)}`);
      }
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? `${err.message}` : String(err);
}
