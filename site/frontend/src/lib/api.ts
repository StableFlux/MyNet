import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,  // send httpOnly cookie on all requests
})

api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401) {
      // Redirect to login unless already there
      if (!window.location.pathname.startsWith('/login') &&
          !window.location.pathname.startsWith('/setup')) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default api
