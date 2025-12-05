FROM node:18-alpine3.17

# Install nginx, python3, pip, ffmpeg
RUN apk add --no-cache nginx python3 py3-pip ffmpeg

# Install yt-dlp
RUN pip3 install yt-dlp

# Set working directory
WORKDIR /app

# Copy BOTH package files (backend has package.json, root has package-lock.json)
COPY backend/package.json ./
COPY package-lock.json ./

# Fix npm cache + install deps
RUN npm cache clean --force && npm ci --only=production

# Copy backend source code
COPY backend/ ./backend/

# Copy nginx configs FROM ROOT
// COPY nginx.conf /etc/nginx/nginx.conf
// COPY nginx-frontend.conf /etc/nginx/conf.d/default.conf

# Copy frontend static files to nginx
COPY frontend/ /usr/share/nginx/html/

# Create nginx directories
RUN mkdir -p /var/run/nginx /var/log/nginx /usr/share/nginx/html

# Fix permissions
RUN chown -R nginx:nginx /var/log/nginx /var/run/nginx /usr/share/nginx/html

# Expose HTTP (Render) + RTMP
EXPOSE 80 1935

# Start nginx + Node.js
CMD sh -c "nginx -g 'daemon off;' & cd /app && node backend/index.js & wait"





