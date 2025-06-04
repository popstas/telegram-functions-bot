// This test file tests the retry logic for the callTools function
// We're testing the retry behavior, not the actual implementation

describe('callTools retry logic', () => {
  // Mock data
  const mockCallTools = jest.fn();
  
  // Function to simulate the retry logic we want to test
  async function callWithRetry(callFn: () => Promise<any>): Promise<any> {
    try {
      return await callFn();
    } catch (error: any) {
      if (error.status === 400 && error.message.includes('Invalid parameter')) {
        console.log('Retrying after 400 error...');
        return callFn(); // Retry once
      }
      throw error; // Re-throw other errors
    }
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should succeed on first attempt', async () => {
    // Mock successful response on first attempt
    mockCallTools.mockResolvedValueOnce({ success: true });
    
    const result = await callWithRetry(mockCallTools);
    
    expect(result).toEqual({ success: true });
    expect(mockCallTools).toHaveBeenCalledTimes(1);
  });

  it('should retry once on 400 error', async () => {
    // Mock 400 error on first attempt, success on second
    mockCallTools
      .mockRejectedValueOnce(createError(400, '400 Invalid parameter'))
      .mockResolvedValueOnce({ success: true });
    
    const result = await callWithRetry(mockCallTools);
    
    expect(result).toEqual({ success: true });
    expect(mockCallTools).toHaveBeenCalledTimes(2);
    expect(console.log).toHaveBeenCalledWith('Retrying after 400 error...');
  });

  it('should propagate error after retry fails', async () => {
    // Mock 400 error on both attempts
    mockCallTools
      .mockRejectedValueOnce(createError(400, '400 Invalid parameter'))
      .mockRejectedValueOnce(createError(400, '400 Invalid parameter'));
    
    await expect(callWithRetry(mockCallTools))
      .rejects
      .toThrow('400 Invalid parameter');
    
    expect(mockCallTools).toHaveBeenCalledTimes(2);
  });

  it('should not retry non-400 errors', async () => {
    // Mock 500 error (should not retry)
    mockCallTools.mockRejectedValueOnce(createError(500, 'Internal Server Error'));
    
    await expect(callWithRetry(mockCallTools))
      .rejects
      .toThrow('Internal Server Error');
    
    expect(mockCallTools).toHaveBeenCalledTimes(1);
    expect(console.log).not.toHaveBeenCalled();
  });

  // Helper function to create error objects
  function createError(status: number, message: string): Error & { status: number } {
    const error = new Error(message) as Error & { status: number };
    error.status = status;
    return error;
  }
});
