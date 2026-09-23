import { Mutex } from "async-mutex";

type ReferenceCountedMutex = { count: number; mutex: Mutex };

export class SequentialRunner {
  private mutexes: Record<string, ReferenceCountedMutex>;

  constructor() {
    this.mutexes = {};
  }

  async runSequentiallyPerId<T>(
    id: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const mutex = this.getMutex(id);

    mutex.count = mutex.count + 1;

    try {
      return await mutex.mutex.runExclusive(task);
    } finally {
      mutex.count = mutex.count - 1;

      if (mutex.count === 0) {
        delete this.mutexes[id];
      }
    }
  }

  private getMutex(id: string): ReferenceCountedMutex {
    const existingMutex = this.mutexes[id];

    if (!existingMutex) {
      const newMutex = { count: 0, mutex: new Mutex() };
      this.mutexes[id] = newMutex;
      return newMutex;
    } else {
      return existingMutex;
    }
  }
}
