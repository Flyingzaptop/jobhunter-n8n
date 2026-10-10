export function transientApplicationError(error,attempts=0){
 return attempts<3&&/Execution context was destroyed|navigation|Timeout|NETWORK_TIMEOUT|SESSION_NOT_FOUND|SESSION_CLOSING_RETRY|BROWSER_CAPACITY_RETRY|net::ERR_/i.test(String(error.message??error));
}
