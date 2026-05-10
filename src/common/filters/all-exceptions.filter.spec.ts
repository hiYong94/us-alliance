import { ArgumentsHost, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { JobNotFoundException } from '../../jobs/exceptions/job.exceptions';
import { LoggerService } from '../../logging/logger.service';
import { traceContext } from '../context/trace-context';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  let logger: jest.Mocked<LoggerService>;
  let filter: AllExceptionsFilter;
  let response: { status: jest.Mock; json: jest.Mock };

  beforeEach(() => {
    logger = { append: jest.fn() } as unknown as jest.Mocked<LoggerService>;
    filter = new AllExceptionsFilter(logger);
    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  function makeHost(method: string, url: string): ArgumentsHost {
    const req = { method, url } as Partial<Request>;
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => response as unknown as Response,
      }),
    } as unknown as ArgumentsHost;
  }

  it('도메인 예외(JobNotFound)의 code · status 를 추출한다', () => {
    filter.catch(new JobNotFoundException('abc'), makeHost('GET', '/jobs/abc'));

    expect(response.status).toHaveBeenCalledWith(404);
    const body = response.json.mock.calls[0][0];
    expect(body).toMatchObject({
      statusCode: 404,
      code: 'JOB_NOT_FOUND',
      path: '/jobs/abc',
    });
    expect(body.message).toContain('abc');
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('class-validator 의 BadRequestException 은 VALIDATION_FAILED 로 매핑', () => {
    filter.catch(
      new BadRequestException({
        statusCode: 400,
        message: ['title should not be empty', 'title must be longer than 1'],
        error: 'Bad Request',
      }),
      makeHost('POST', '/jobs'),
    );

    expect(response.status).toHaveBeenCalledWith(400);
    const body = response.json.mock.calls[0][0];
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.message).toBe('title should not be empty, title must be longer than 1');
  });

  it('도메인 외 HttpException 은 status 기반 fallback 코드를 받는다', () => {
    filter.catch(new HttpException('teapot', HttpStatus.I_AM_A_TEAPOT), makeHost('GET', '/x'));

    expect(response.status).toHaveBeenCalledWith(HttpStatus.I_AM_A_TEAPOT);
    expect(response.json.mock.calls[0][0]).toMatchObject({ code: 'HTTP_ERROR' });
  });

  it('알 수 없는 throw 값은 500 INTERNAL_SERVER_ERROR 로 응답', () => {
    filter.catch(new Error('unexpected boom'), makeHost('GET', '/x'));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json.mock.calls[0][0]).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: '서버 내부 오류',
    });
  });

  it('details 필드가 있는 예외는 응답 body 에 포함된다', () => {
    const exception = Object.assign(new HttpException('oops', 409), {
      details: { foo: 'bar' },
    });
    filter.catch(exception, makeHost('PATCH', '/jobs/x'));

    expect(response.json.mock.calls[0][0]).toMatchObject({
      details: { foo: 'bar' },
    });
  });

  it('logger.append 가 4xx 에는 warn 으로 호출된다', () => {
    filter.catch(new JobNotFoundException('x'), makeHost('GET', '/jobs/x'));

    expect(logger.append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'http',
        level: 'warn',
        method: 'GET',
        path: '/jobs/x',
        status: 404,
        code: 'JOB_NOT_FOUND',
      }),
    );
  });

  it('logger.append 가 5xx 에는 error 로 호출된다', () => {
    filter.catch(new Error('boom'), makeHost('GET', '/x'));

    expect(logger.append).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', status: 500 }),
    );
  });

  it('현재 컨텍스트의 traceId 를 로그에 포함한다', () => {
    traceContext.run({ traceId: 'tid-error' }, () => {
      filter.catch(new JobNotFoundException('x'), makeHost('GET', '/x'));
    });

    expect(logger.append).toHaveBeenCalledWith(expect.objectContaining({ traceId: 'tid-error' }));
  });
});
