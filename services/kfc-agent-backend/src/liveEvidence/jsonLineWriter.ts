export interface JsonLineWritable {
  write(chunk: string, callback: (error?: Error | null) => void): boolean;
  once(event: 'error', listener: (error: Error) => void): unknown;
  removeListener(event: 'error', listener: (error: Error) => void): unknown;
}

export function createJsonLineWriter(
  stream: JsonLineWritable,
): (line: string) => Promise<void> {
  return (line) =>
    new Promise<void>((resolve, reject) => {
      let settled = false;
      const removeErrorListener = () => {
        stream.removeListener('error', onStreamError);
      };
      const onStreamError = (error: Error) => {
        if (settled) return;
        settled = true;
        removeErrorListener();
        reject(error);
      };
      stream.once('error', onStreamError);
      try {
        stream.write(`${line}\n`, (error) => {
          if (settled) return;
          settled = true;
          if (error) {
            // Node Writable calls the write callback before emitting its
            // matching error event. Keep the one-shot listener through this
            // event-loop turn so it cannot become an unhandled process error.
            setImmediate(removeErrorListener);
            reject(error);
          } else {
            removeErrorListener();
            resolve();
          }
        });
      } catch (error) {
        settled = true;
        removeErrorListener();
        reject(error);
      }
    });
}
