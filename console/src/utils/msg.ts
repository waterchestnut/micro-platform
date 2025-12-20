import {message} from 'antd';

message.config({
  top: 64
});

export const errorMessage = (content: any, duration = 5) => {
  message.error(content, duration);
};

export const successMessage = (content: any, duration = 5) => {
  message.success(content, duration);
};

export const warnMessage = (content: any, duration = 5) => {
  message.warning(content, duration);
};
