export class AbortError extends Error {
  constructor() {
    super("Abgebrochen");
    this.name = "AbortError";
  }
}
