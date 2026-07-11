-- KEYS[1]: rate limit key
-- ARGV[1]: window size in seconds
-- returns: current request count within the window
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
