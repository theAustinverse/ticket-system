-- KEYS[1]: shared stock key
-- KEYS[2]: group-order counter key (how many bundles already sold)
-- ARGV[1]: quantity to decrement (bundle size, e.g. 11)
-- ARGV[2]: max group orders allowed
-- returns: remaining stock (>= 0) on success,
--          -1 insufficient stock, -2 stock key not initialized,
--          -3 group order cap reached
local stock = redis.call('GET', KEYS[1])
if stock == false then
  return -2
end

local groupCount = tonumber(redis.call('GET', KEYS[2]) or '0')
local maxGroups = tonumber(ARGV[2])
if groupCount >= maxGroups then
  return -3
end

local quantity = tonumber(ARGV[1])
local current = tonumber(stock)
if current < quantity then
  return -1
end

redis.call('INCR', KEYS[2])
return redis.call('DECRBY', KEYS[1], quantity)
