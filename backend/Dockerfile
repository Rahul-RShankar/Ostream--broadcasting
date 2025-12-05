FROM node:18-alpine3.17

# Install nginx, python3, pip, ffmpeg (ALL dependencies)
RUN apk add --no-cache nginx python3 py3-pip ffmpeg

# Install yt-dlp
RUN pip3 install yt-dlp

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Fix npm cache issue + install
RUN npm cache clean --force && npm ci --only=production

# Copy backend source code
COPY backend/ .

# Copy nginx configs FROM ROOT (build context = .)
COPY nginx.conf /etc/nginx/nginx.conf
COPY nginx-frontend.conf /etc/nginx/conf.d/default.conf

# Copy frontend static files to nginx
COPY frontend/ /usr/share/nginx/html/

# Create nginx directories
RUN mkdir -p /var/run/nginx /var/log/nginx /usr/share/nginx/html

# Fix nginx config permissions
RUN chown -R nginx:nginx /var/log/nginx /var/run/nginx /usr/share/nginx/html

# Expose HTTP (Render requirement) + RTMP
EXPOSE 80 1935

# Start nginx + Node.js together
CMD sh -c "nginx -g 'daemon off;' & node index.js"
