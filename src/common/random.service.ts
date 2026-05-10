import { Injectable } from '@nestjs/common';

/**
 * Math.random 을 의존성 주입 가능하도록 한 얇은 wrapper
 *
 * **이 추상화는 도메인의 처리 시뮬레이션이 의도적 무작위 실패(10%) 를 포함하기 때문에
 * 도입한다**. 단위 테스트에서 결정적 결과를 검증하려면 무작위성을 통제할 수 있어야
 * 하므로, 직접 `Math.random()` 을 호출하는 대신 이 서비스를 주입받아 사용한다.
 *
 * 단순 호출 wrapping 한 줄짜리 추상화가 작아 보일 수 있으나, 도입 의도(테스트 결정성) 가
 * 코드에서 명시적으로 드러나는 점이 가치다. 대안: 전역 `Math.random` 모킹 — 더 가볍지만
 * "이 코드는 무작위성에 의존한다" 가 코드에서 드러나지 않음.
 */
@Injectable()
export class RandomService {
  /** 0 이상 1 미만의 무작위 실수를 반환한다 */
  next(): number {
    return Math.random();
  }
}
