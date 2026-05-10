import { Injectable } from '@nestjs/common';
import { Mutex } from 'async-mutex';

/**
 * Job 데이터에 대한 read-modify-write 를 직렬화하는 단일 mutex
 *
 * Service · Scheduler 의 모든 mutation 경로(생성 · 수정 · 클레임 · 마킹) 가
 * 이 인스턴스의 runExclusive 를 통과하여 lost update 를 방지한다.
 *
 * 멀티 프로세스 환경은 보호 불가 — README 회고에 외부 락 (Redis Redlock) 또는
 * 낙관적 락 확장 가능성을 명시한다.
 */
@Injectable()
export class JobsMutex {
  private readonly mutex = new Mutex();

  /**
   * 콜백을 배타 실행한다 — 동일 인스턴스의 다른 runExclusive 호출과 직렬화됨
   *
   * @param fn 락을 보유한 채 실행될 비동기 콜백
   * @returns fn 의 반환값
   */
  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this.mutex.runExclusive(fn);
  }
}
