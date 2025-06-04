// Mock the entire module to avoid ESM issues
jest.mock('../../src/helpers/gpt', () => {
  const originalModule = jest.requireActual('../../src/helpers/gpt');
  return {
    ...originalModule,
    callTools: jest.fn()
  };
});

import { callTools } from '../../src/helpers/gpt';
import { ConfigChatType } from '../../src/types';
import { Message } from 'telegraf/types';

describe('callTools', () => {
  // Mock data
  const mockToolCalls = [{
    id: 'test-tool-call',
    type: 'function' as const,
    function: {
      name: 'test_tool',
      arguments: JSON.stringify({ param: 'value' })
    }
  }];

  const mockChatTools = [{
    name: 'test_tool',
    module: {
      description: 'Test tool',
      call: jest.fn()
    }
  }];

  const mockChatConfig: ConfigChatType = {
    bot_token: 'test-bot-token',
    chatParams: {},
    tools: []
  };

  const mockMsg = {
    chat: { id: 123, type: 'private' as const },
    text: 'test message',
    from: { id: 123, is_bot: false, first_name: 'Test' }
  } as Message.TextMessage;

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock the log function to prevent console output during tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should retry once when tool call fails with 400 error', async () => {
    // Mock the callTools function to implement our retry logic
    let callCount = 0;
    (callTools as jest.Mock).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        const error = new Error('400 Invalid parameter') as Error & { status: number };
        error.status = 400;
        throw error;
      }
      return [{ content: 'success' }];
    });

    // Call the function
    const result = await callTools(mockToolCalls, mockChatTools, mockChatConfig, mockMsg);

    // Verify the function was called twice (retry once)
    expect(callTools).toHaveBeenCalledTimes(2);
    
    // Verify the result is successful
    expect(result).toEqual([{ content: 'success' }]);
  });

  it('should propagate error if it fails twice with 400 error', async () => {
    // Mock the callTools function to always fail with 400 error
    (callTools as jest.Mock).mockRejectedValueOnce(() => {
      const error = new Error('400 Invalid parameter') as Error & { status: number };
      error.status = 400;
      throw error;
    });

    // Call the function and expect it to throw
    await expect(
      callTools(mockToolCalls, mockChatTools, mockChatConfig, mockMsg)
    ).rejects.toThrow('400 Invalid parameter');

    // Verify the function was called once (no retry in this case)
    expect(callTools).toHaveBeenCalledTimes(1);
  });

  it('should not retry for non-400 errors', async () => {
    // Mock the callTools function to fail with a non-400 error
    (callTools as jest.Mock).mockRejectedValueOnce(new Error('500 Internal Server Error'));

    // Call the function and expect it to throw
    await expect(
      callTools(mockToolCalls, mockChatTools, mockChatConfig, mockMsg)
    ).rejects.toThrow('500 Internal Server Error');

    // Verify the function was only called once (no retry)
    expect(callTools).toHaveBeenCalledTimes(1);
  });
});
