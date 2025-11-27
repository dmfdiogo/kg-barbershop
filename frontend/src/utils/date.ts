import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export const formatDateTime = (date: string | Date): string => {
    return dayjs(date).format('MMMM D, YYYY h:mm A');
};

export const formatDate = (date: string | Date): string => {
    return dayjs(date).format('MMMM D, YYYY');
};

export const formatTime = (date: string | Date): string => {
    return dayjs(date).format('h:mm A');
};

export const toISOString = (date: Date): string => {
    return dayjs(date).toISOString();
};
