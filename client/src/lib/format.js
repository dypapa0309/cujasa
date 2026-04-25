export const price = (value) => value ? `${Number(value).toLocaleString()}원` : '가격 확인 필요';
export const dateTime = (value) => value ? new Date(value).toLocaleString('ko-KR') : '-';
