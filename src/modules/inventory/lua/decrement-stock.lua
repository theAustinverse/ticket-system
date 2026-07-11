-- KEYS[1]: stock key, e.g. stock:{ticketTypeId}
-- ARGV[1]: quantity requested
-- returns: remaining stock (>= 0) on success, -1 if insufficient stock, -2 if stock key not initialized
local stock = redis.call('GET', KEYS[1])
if stock == false then
  return -2
end

local quantity = tonumber(ARGV[1])
local current = tonumber(stock)

if current < quantity then
  return -1
end

return redis.call('DECRBY', KEYS[1], quantity)
