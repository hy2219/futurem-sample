import type { ExecFileException, ExecFileOptionsWithStringEncoding } from "node:child_process";

type Result = { error?: ExecFileException; stdout?: string; stderr?: string };
type Callback = (error: ExecFileException | null, stdout: string, stderr: string) => void;
type Call = {
  command: string; args: readonly string[]; options: ExecFileOptionsWithStringEncoding;
  callback: Callback; completed: boolean;
};

class Builds {
  calls: Call[] = [];
  active = 0;
  peak = 0;
  private automatic = true;
  private responses: Record<string, Result> = {};

  setAutoComplete(value: boolean): void { this.automatic = value; }
  setResponse(image: string, result: Result): void { this.responses[image] = result; }
  complete(index: number, result?: Result): void {
    const call = this.calls[index];
    if (!call || call.completed) throw new Error("No pending build callback");
    call.completed = true;
    this.active--;
    const image = call.args[call.args.indexOf("--image") + 1].split(":")[0];
    const response = result ?? this.responses[image] ?? {};
    call.callback(response.error ?? null,
      response.stdout ?? JSON.stringify({ runId: `run-${index + 1}`, status: "Succeeded" }), response.stderr ?? "");
  }
  respond(command: string, args: readonly string[], options: ExecFileOptionsWithStringEncoding, callback: Callback): void {
    const index = this.calls.length;
    this.calls.push({ command, args: [...args], options, callback, completed: false });
    this.active++;
    this.peak = Math.max(this.peak, this.active);
    if (this.automatic) queueMicrotask(() => this.complete(index));
  }
}

export let builds = new Builds();
export const execFile = vi.fn((command: string, args: readonly string[], options: ExecFileOptionsWithStringEncoding, callback: Callback) =>
  builds.respond(command, args, options, callback));
export function resetBuilds(): void {
  builds = new Builds();
  execFile.mockClear();
}
