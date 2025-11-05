FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV UPLOAD_DIR=/app/uploads
ENV MAX_FILE_SIZE=10485760
ENV PORT=3000
ENV PUBLIC_HOST=http://localhost:3000


RUN mkdir -p $UPLOAD_DIR

EXPOSE 3000
CMD ["npm", "start"]
