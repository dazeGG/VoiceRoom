// A service double for route tests: each async method it is given records the
// arguments of its last call and resolves to a set answer, so a test drives a
// route and then checks both what the route answered and what it asked.

type AsyncMethod = (...args: never[]) => Promise<unknown>;

/** The async methods of `Service`, each with the value it resolves to. */
export type Answers<Service> = {
  [Name in keyof Service as Service[Name] extends AsyncMethod ? Name : never]?: Awaited<
    Service[Name] extends AsyncMethod ? ReturnType<Service[Name]> : never
  >;
};

/** The arguments of each method's last call. */
export type Calls<Service> = {
  [Name in keyof Service]?: Service[Name] extends (...args: infer Args) => unknown ? Args : never;
};

/**
 * The double and its recorded calls. Like `fake`, it stands where the real
 * service goes on trust: the answers are checked against the real return
 * types, and a method without an answer fails loudly in the test that calls it.
 */
export function recordingService<Service>(answers: Answers<Service>): { service: Service; seen: Calls<Service> };
export function recordingService(answers: Record<string, unknown>): { service: unknown; seen: object } {
  const seen: Record<string, unknown[]> = {};
  const service = Object.fromEntries(
    Object.entries(answers).map(([name, answer]) => [
      name,
      async (...args: unknown[]) => {
        seen[name] = args;
        return answer;
      }
    ])
  );
  return { service, seen };
}
