FROM apify/actor-node:20
COPY package*.json ./
RUN npm --quiet set progress=false && npm install --omit=dev && echo "Installed:" && npm list --omit=dev || true
COPY . ./
CMD npm start --silent
